/**
 * 音声ファイルを Markdown に変換します。
 *
 * 使い方:
 *   node src/transcribe_audio.js [--target=general|houhi] [--provider=openai|gemini] [--model=MODEL] <音声ファイル...>
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config_loader');

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
    '.mp3',
    '.mp4',
    '.mpeg',
    '.mpga',
    '.m4a',
    '.wav',
    '.webm',
    '.aac',
    '.flac',
    '.ogg',
    '.oga',
]);

const DEFAULT_OPENAI_MODEL = 'gpt-4o-transcribe-diarize';
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const DEFAULT_PROVIDER = 'openai';
const DEFAULT_TARGET = 'houhi';
const OPENAI_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const GEMINI_INLINE_MAX_AUDIO_BYTES = 20 * 1024 * 1024;

type TranscriptItem = {
    speaker: string;
    time: string;
    text: string;
};

type TranscriptionOptions = {
    provider: string;
    model?: string;
    language: string;
    target: string;
    openaiApiKey?: string;
    geminiApiKey?: string;
};

function isSupportedAudioPath(filePath: string) {
    return SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function parseArgs(argv: string[]) {
    const options: Record<string, string | boolean> = {};
    const files: string[] = [];

    for (const arg of argv) {
        if (arg.startsWith('--provider=')) {
            options.provider = arg.slice('--provider='.length).trim();
        } else if (arg.startsWith('--model=')) {
            options.model = arg.slice('--model='.length).trim();
        } else if (arg.startsWith('--language=')) {
            options.language = arg.slice('--language='.length).trim();
        } else if (arg.startsWith('--target=')) {
            options.target = arg.slice('--target='.length).trim();
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            files.push(arg);
        }
    }

    return { options, files };
}

function normalizeOptions(cliOptions: Record<string, string | boolean>): TranscriptionOptions {
    const config = loadConfig() || {};
    const transcription = config.transcription || {};
    const provider = String(cliOptions.provider || transcription.provider || DEFAULT_PROVIDER).toLowerCase();
    const language = String(cliOptions.language || transcription.language || 'ja');
    const target = normalizeTarget(cliOptions.target || transcription.target || DEFAULT_TARGET);
    const providerModel = provider === 'gemini'
        ? transcription.geminiModel || DEFAULT_GEMINI_MODEL
        : transcription.openaiModel || DEFAULT_OPENAI_MODEL;

    return {
        provider,
        model: String(cliOptions.model || transcription.model || providerModel || '').trim() || undefined,
        language,
        target,
        openaiApiKey: transcription.openaiApiKey || config.openai?.apiKey || process.env.OPENAI_API_KEY,
        geminiApiKey: transcription.geminiApiKey || config.gemini?.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    };
}

function normalizeTarget(value: any) {
    const text = String(value || '').toLowerCase();
    return text === 'general' ? 'general' : 'houhi';
}

function getMimeType(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.mp4': 'audio/mp4',
        '.mpeg': 'audio/mpeg',
        '.mpga': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.wav': 'audio/wav',
        '.webm': 'audio/webm',
        '.aac': 'audio/aac',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
        '.oga': 'audio/ogg',
    };
    return map[ext] || 'application/octet-stream';
}

function basenameWithoutExt(filePath: string) {
    return path.basename(filePath, path.extname(filePath));
}

function outputPathForAudio(filePath: string, items: TranscriptItem[] = [], overview: Record<string, string> = {}, target = DEFAULT_TARGET) {
    const baseName = buildTranscriptBaseName(filePath, items, overview, target);
    return resolveUniqueOutputPath(path.join(path.dirname(filePath), `${baseName}.md`));
}

function pad2(value: number) {
    return String(value).padStart(2, '0');
}

function formatDate(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getFileDate(filePath: string) {
    try {
        return formatDate(fs.statSync(filePath).mtime);
    } catch (_err) {
        return formatDate(new Date());
    }
}

function normalizeJapaneseDateForFilename(value: any) {
    const text = String(value || '').trim();
    const iso = text.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
    if (iso) {
        return `${iso[1]}-${pad2(Number(iso[2]))}-${pad2(Number(iso[3]))}`;
    }

    const era = text.match(/(令和|平成|昭和)(元|\d{1,2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (!era) {
        return '';
    }

    const eraName = era[1];
    const eraYear = era[2] === '元' ? 1 : Number(era[2]);
    const base = eraName === '令和' ? 2018 : eraName === '平成' ? 1988 : 1925;
    return `${base + eraYear}-${pad2(Number(era[3]))}-${pad2(Number(era[4]))}`;
}

function sanitizeFilenamePart(value: string, maxLength = 40) {
    let text = String(value || '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/[＿]+/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.。・,，、]+|[\s.。・,，、]+$/g, '')
        .trim();

    if (text.length > maxLength) {
        text = text.slice(0, maxLength).replace(/[、，。,.・\s]+$/g, '').trim();
    }
    return text || '録音内容';
}

function removeGreetingPrefix(text: string) {
    return text
        .replace(/^(はい、?|ええ、?|あの、?|えっと、?|その、?|お世話になります。?|ありがとうございます。?|失礼します。?)+/g, '')
        .trim();
}

function inferTranscriptTitle(items: TranscriptItem[], overview: Record<string, string> = {}) {
    const explicit = sanitizeFilenamePart(String(overview.title || overview.subject || '').trim(), 36);
    if (explicit !== '録音内容') {
        return explicit;
    }

    const candidate = items
        .map(item => removeGreetingPrefix(item.text))
        .find(text => text.length >= 8) || items.map(item => item.text).find(Boolean) || '';

    return sanitizeFilenamePart(candidate, 36);
}

function buildTranscriptBaseName(filePath: string, items: TranscriptItem[] = [], overview: Record<string, string> = {}, target = DEFAULT_TARGET) {
    const date = normalizeJapaneseDateForFilename(overview.date) || getFileDate(filePath);
    const title = inferTranscriptTitle(items, overview);
    const documentKind = normalizeTarget(target) === 'general' ? '音声認識' : '反訳書';
    return sanitizeFilenamePart(`${date}_${documentKind}_${title}`, 90);
}

function resolveUniqueOutputPath(outputPath: string) {
    if (!fs.existsSync(outputPath)) {
        return outputPath;
    }

    const ext = path.extname(outputPath);
    const stem = path.basename(outputPath, ext);
    const dir = path.dirname(outputPath);

    for (let i = 2; i < Number.MAX_SAFE_INTEGER; i++) {
        const candidate = path.join(dir, `${stem} (${i})${ext}`);
        if (!fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error(`空いている出力ファイル名が見つかりません: ${outputPath}`);
}

function sanitizeMarkdownCell(value: string) {
    return String(value || '')
        .replace(/\r?\n+/g, ' ')
        .replace(/\|/g, '｜')
        .trim();
}

function secondsToTimestamp(value: any) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '';
    }
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function normalizeSpeaker(value: any, fallback = '不明') {
    const text = String(value || '').trim();
    if (!text) {
        return fallback;
    }
    if (/^[A-Z]$/i.test(text)) {
        return `話者${text.toUpperCase()}`;
    }
    return text
        .replace(/^speaker[_\s-]*/i, '話者')
        .replace(/^話者\s*(\d+)$/i, '話者$1');
}

function stripCodeFence(text: string) {
    const trimmed = String(text || '').trim();
    const fenced = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : trimmed;
}

function extractJson(text: string) {
    const cleaned = stripCodeFence(text);
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) {
        return null;
    }
    try {
        return JSON.parse(match[0]);
    } catch (_err) {
        return null;
    }
}

function normalizeTranscriptItems(raw: any): TranscriptItem[] {
    const source = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.items)
            ? raw.items
            : Array.isArray(raw?.segments)
                ? raw.segments
                : Array.isArray(raw?.transcript)
                    ? raw.transcript
                    : [];

    const items = source
        .map((item: any, index: number) => {
            const text = String(item?.text || item?.content || item?.utterance || '').trim();
            if (!text) {
                return null;
            }
            return {
                speaker: normalizeSpeaker(item?.speaker || item?.speaker_label || item?.speakerLabel || item?.role, `話者${index + 1}`),
                time: String(item?.time || item?.timestamp || secondsToTimestamp(item?.start || item?.start_time || item?.startTime) || '').trim(),
                text,
            };
        })
        .filter(Boolean);

    return items as TranscriptItem[];
}

function parsePlainTranscript(text: string): TranscriptItem[] {
    const cleaned = stripCodeFence(text);
    const lines = cleaned
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const parsed: TranscriptItem[] = [];
    for (const line of lines) {
        const match = line.match(/^(?:\[(?<time1>\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?(?<speaker>[^:：]{1,24})[:：]\s*(?<text>.+)$/);
        if (match?.groups?.text) {
            parsed.push({
                speaker: normalizeSpeaker(match.groups.speaker, '不明'),
                time: match.groups.time1 || '',
                text: match.groups.text.trim(),
            });
        }
    }

    if (parsed.length > 0) {
        return parsed;
    }

    return cleaned
        .split(/\n{2,}/)
        .map(part => part.trim())
        .filter(Boolean)
        .map((part, index) => ({
            speaker: index % 2 === 0 ? '話者1' : '話者2',
            time: '',
            text: part.replace(/\s+/g, ' '),
        }));
}

function parseTranscriptResponse(text: string): TranscriptItem[] {
    const json = extractJson(text);
    const jsonItems = normalizeTranscriptItems(json);
    if (jsonItems.length > 0) {
        return jsonItems;
    }
    return parsePlainTranscript(text);
}

function getTemplateInstruction() {
    const candidates = [
        path.resolve(process.cwd(), 'houhi-drafting-kit', '反訳書.md'),
        path.resolve(__dirname, '../../houhi-drafting-kit/反訳書.md'),
        path.resolve(__dirname, '../templates/反訳書.md'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return fs.readFileSync(candidate, 'utf-8');
        }
    }

    return '';
}

function buildTranscriptPrompt(fileName: string, language: string, target = DEFAULT_TARGET) {
    const template = getTemplateInstruction();
    const isHouhi = normalizeTarget(target) === 'houhi';
    return [
        isHouhi
            ? '音声を日本語の裁判提出用「反訳書」Markdownにするため、発言者分離つきで文字起こししてください。'
            : '音声を一般用途のMarkdown記録にするため、発言者分離つきで文字起こししてください。',
        '出力はJSONのみです。Markdownや説明文は出力しないでください。',
        '形式: {"overview":{"date":"","place":"","people":""},"items":[{"speaker":"話者1","time":"00:00","text":"発言内容"}]}',
        'time は発言開始時刻を MM:SS または HH:MM:SS で入れてください。不明なら空文字にしてください。',
        'speaker は分かる範囲で氏名・役職にし、不明なら 話者1, 話者2 のようにしてください。',
        `音声ファイル名: ${fileName}`,
        `言語: ${language}`,
        isHouhi && template ? `反訳書テンプレート:\n${template}` : '',
    ].filter(Boolean).join('\n\n');
}

function buildTranscriptMarkdown(filePath: string, items: TranscriptItem[], overview: Record<string, string> = {}, target = DEFAULT_TARGET) {
    if (normalizeTarget(target) === 'general') {
        return buildGeneralTranscriptMarkdown(filePath, items, overview);
    }
    return buildHouhiTranscriptMarkdown(filePath, items, overview);
}

function buildHouhiTranscriptMarkdown(filePath: string, items: TranscriptItem[], overview: Record<string, string> = {}) {
    const safeItems = items.length > 0 ? items : [{ speaker: '不明', time: '', text: '【文字起こし結果が空です】' }];
    const date = overview.date || '【要確認】';
    const place = overview.place || `【要確認】（${path.basename(filePath)}）`;
    const people = overview.people || Array.from(new Set(safeItems.map(item => item.speaker).filter(Boolean))).join('、') || '【要確認】';

    const rows = safeItems.map((item, index) => {
        return `| ${index + 1} | ${sanitizeMarkdownCell(item.speaker)} | ${sanitizeMarkdownCell(item.time)} | ${sanitizeMarkdownCell(item.text)} |`;
    });

    return [
        '# 反訳書',
        '',
        '## 1 録音概要',
        '',
        `日時：${sanitizeMarkdownCell(date)}`,
        '',
        `場所：${sanitizeMarkdownCell(place)}`,
        '',
        `登場人物：${sanitizeMarkdownCell(people)}`,
        '',
        '',
        '## 2 録音内容',
        '',
        '| No. | 発言者 | 時刻 | 発言内容 |',
        '| :---: | :--- | :---: | :--- |',
        ...rows,
        '',
        '以上',
        '',
    ].join('\n');
}

function buildGeneralTranscriptMarkdown(filePath: string, items: TranscriptItem[], overview: Record<string, string> = {}) {
    const safeItems = items.length > 0 ? items : [{ speaker: '不明', time: '', text: '【文字起こし結果が空です】' }];
    const date = overview.date || '';
    const people = overview.people || Array.from(new Set(safeItems.map(item => item.speaker).filter(Boolean))).join('、') || '';
    const rows = safeItems.map((item, index) => {
        return `| ${index + 1} | ${sanitizeMarkdownCell(item.speaker)} | ${sanitizeMarkdownCell(item.time)} | ${sanitizeMarkdownCell(item.text)} |`;
    });

    return [
        '# 音声認識結果',
        '',
        '## 概要',
        '',
        `- 音声ファイル:${sanitizeMarkdownCell(path.basename(filePath))}`,
        date ? `- 日時:${sanitizeMarkdownCell(date)}` : '',
        people ? `- 話者:${sanitizeMarkdownCell(people)}` : '',
        '',
        '## 文字起こし',
        '',
        '| No. | 発言者 | 時刻 | 発言内容 |',
        '| :---: | :--- | :---: | :--- |',
        ...rows,
        '',
    ].filter(line => line !== '').join('\n');
}

async function transcribeWithOpenAI(filePath: string, options: TranscriptionOptions) {
    if (!options.openaiApiKey) {
        throw new Error('OpenAI APIキーがありません。config.json の transcription.openaiApiKey または OPENAI_API_KEY を設定してください。');
    }

    const model = options.model || DEFAULT_OPENAI_MODEL;
    const fileSize = fs.statSync(filePath).size;
    if (fileSize > OPENAI_MAX_AUDIO_BYTES) {
        throw new Error('OpenAI Transcription API の音声ファイル上限 25MB を超えています。短く分割するか Gemini を使ってください。');
    }

    const form = new FormData();
    const buffer = fs.readFileSync(filePath);
    form.append('file', new Blob([buffer], { type: getMimeType(filePath) }), path.basename(filePath));
    form.append('model', model);
    form.append('language', options.language);
    if (model.includes('diarize')) {
        form.append('response_format', 'diarized_json');
        form.append('chunking_strategy', 'auto');
    } else {
        form.append('response_format', 'json');
        form.append('prompt', buildTranscriptPrompt(path.basename(filePath), options.language, options.target));
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${options.openaiApiKey}`,
        },
        body: form as any,
    });

    const body = await response.text();
    if (!response.ok) {
        throw new Error(`OpenAI transcription failed: ${response.status} ${body}`);
    }

    const parsed = JSON.parse(body);
    const items = normalizeTranscriptItems(parsed);
    if (items.length > 0) {
        return { items, overview: {} };
    }

    return { items: parseTranscriptResponse(parsed.text || body), overview: {} };
}

async function transcribeWithGemini(filePath: string, options: TranscriptionOptions) {
    if (!options.geminiApiKey) {
        throw new Error('Gemini APIキーがありません。config.json の transcription.geminiApiKey または GEMINI_API_KEY を設定してください。');
    }

    const model = options.model || DEFAULT_GEMINI_MODEL;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(options.geminiApiKey)}`;
    const audioPart = await buildGeminiAudioPart(filePath, options.geminiApiKey);
    const request = {
        contents: [
            {
                role: 'user',
                parts: [
                    { text: buildTranscriptPrompt(path.basename(filePath), options.language, options.target) },
                    audioPart,
                ],
            },
        ],
        generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
        },
    };

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });

    const body = await response.text();
    if (!response.ok) {
        throw new Error(`Gemini transcription failed: ${response.status} ${body}`);
    }

    const parsed = JSON.parse(body);
    const text = parsed?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('') || '';
    const json = extractJson(text) || {};
    return {
        items: normalizeTranscriptItems(json).length > 0 ? normalizeTranscriptItems(json) : parseTranscriptResponse(text),
        overview: json.overview || {},
    };
}

async function uploadGeminiFile(filePath: string, apiKey: string) {
    const mimeType = getMimeType(filePath);
    const fileSize = fs.statSync(filePath).size;
    const startResponse = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(fileSize),
            'X-Goog-Upload-Header-Content-Type': mimeType,
        },
        body: JSON.stringify({
            file: {
                display_name: path.basename(filePath),
            },
        }),
    });

    const startBody = await startResponse.text();
    if (!startResponse.ok) {
        throw new Error(`Gemini file upload start failed: ${startResponse.status} ${startBody}`);
    }

    const uploadUrl = startResponse.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
        throw new Error('Gemini file upload URL が返されませんでした。');
    }

    const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Content-Length': String(fileSize),
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize',
        },
        body: fs.readFileSync(filePath),
    });

    const uploadBody = await uploadResponse.text();
    if (!uploadResponse.ok) {
        throw new Error(`Gemini file upload failed: ${uploadResponse.status} ${uploadBody}`);
    }

    const parsed = JSON.parse(uploadBody);
    const fileUri = parsed?.file?.uri;
    if (!fileUri) {
        throw new Error('Gemini file URI が返されませんでした。');
    }

    return {
        fileUri,
        mimeType,
    };
}

async function buildGeminiAudioPart(filePath: string, apiKey: string) {
    const mimeType = getMimeType(filePath);
    const fileSize = fs.statSync(filePath).size;
    if (fileSize <= GEMINI_INLINE_MAX_AUDIO_BYTES) {
        return {
            inlineData: {
                mimeType,
                data: fs.readFileSync(filePath).toString('base64'),
            },
        };
    }

    console.log('[情報] 20MBを超える音声のため、Gemini Files API にアップロードします');
    const uploaded = await uploadGeminiFile(filePath, apiKey);
    return {
        fileData: {
            mimeType: uploaded.mimeType,
            fileUri: uploaded.fileUri,
        },
    };
}

async function transcribeAudio(filePath: string, options: TranscriptionOptions) {
    if (options.provider === 'gemini') {
        return transcribeWithGemini(filePath, options);
    }
    if (options.provider === 'openai') {
        return transcribeWithOpenAI(filePath, options);
    }
    throw new Error(`未対応の反訳プロバイダーです: ${options.provider}`);
}

function printUsage() {
    console.log('-------------------------------------------------------');
    console.log(' 音声ファイルを Markdown に変換します。');
    console.log('');
    console.log(' 使い方:');
    console.log('   node transcribe_audio.js [--target=general|houhi] [--provider=openai|gemini] [--model=MODEL] <音声ファイル...>');
    console.log('');
    console.log(' 対応拡張子: ' + Array.from(SUPPORTED_AUDIO_EXTENSIONS).join(', '));
    console.log('-------------------------------------------------------');
}

async function main() {
    const { options: cliOptions, files } = parseArgs(process.argv.slice(2));
    if (cliOptions.help || files.length === 0) {
        printUsage();
        return;
    }

    const options = normalizeOptions(cliOptions);
    const model = options.model || (options.provider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL);
    console.log(`[情報] 反訳プロバイダー: ${options.provider}`);
    console.log(`[情報] モデル: ${model}`);
    console.log(`[情報] 出力形式: ${options.target === 'general' ? '一般' : '法匪'}`);

    for (const inputPath of files) {
        const filePath = path.resolve(inputPath);
        if (!fs.existsSync(filePath)) {
            console.error(`[エラー] ファイルが見つかりません: ${filePath}`);
            continue;
        }
        if (!isSupportedAudioPath(filePath)) {
            console.error(`[エラー] 未対応の音声形式です: ${path.basename(filePath)}`);
            continue;
        }

        console.log(`[開始] ${path.basename(filePath)} を音声認識します`);
        const result = await transcribeAudio(filePath, { ...options, model });
        const markdown = buildTranscriptMarkdown(filePath, result.items, result.overview, options.target);
        const outputPath = outputPathForAudio(filePath, result.items, result.overview, options.target);
        fs.writeFileSync(outputPath, markdown, 'utf-8');
        console.log(`[成功] ${outputPath} に保存しました`);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(`[エラー] ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    });
}

module.exports = {
    SUPPORTED_AUDIO_EXTENSIONS,
    isSupportedAudioPath,
    parseTranscriptResponse,
    buildTranscriptMarkdown,
    buildGeneralTranscriptMarkdown,
    buildHouhiTranscriptMarkdown,
    outputPathForAudio,
    buildTranscriptBaseName,
};
