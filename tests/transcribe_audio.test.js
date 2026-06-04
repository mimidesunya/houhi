const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    isSupportedAudioPath,
    parseTranscriptResponse,
    buildTranscriptMarkdown,
    buildGeneralTranscriptMarkdown,
    outputPathForAudio,
    buildTranscriptBaseName,
} = require('../dist/src/transcribe_audio.js');

test('transcribe_audio: accepts common audio extensions', () => {
    assert.equal(isSupportedAudioPath('sample.mp3'), true);
    assert.equal(isSupportedAudioPath('sample.WAV'), true);
    assert.equal(isSupportedAudioPath('sample.m4a'), true);
    assert.equal(isSupportedAudioPath('sample.pdf'), false);
});

test('transcribe_audio: parses JSON transcript items', () => {
    const items = parseTranscriptResponse(JSON.stringify({
        items: [
            { speaker: 'speaker_1', time: '00:05', text: 'お世話になります。' },
            { speaker: '鈴木', start: 12, text: 'はい、承知しました。' },
        ],
    }));

    assert.deepEqual(items, [
        { speaker: '話者1', time: '00:05', text: 'お世話になります。' },
        { speaker: '鈴木', time: '00:12', text: 'はい、承知しました。' },
    ]);
});

test('transcribe_audio: builds HOUHI transcript markdown', () => {
    const markdown = buildTranscriptMarkdown('recording.wav', [
        { speaker: '山田', time: '00:08', text: '先日の件について伺います。' },
        { speaker: '鈴木', time: '00:15', text: 'はい、どのような件でしょうか。' },
    ], {
        date: '令和7年1月15日 午後2時頃',
        place: '電話録音',
        people: '山田、鈴木',
    }, 'houhi');

    assert.match(markdown, /^# 反訳書$/m);
    assert.match(markdown, /^## 1 録音概要$/m);
    assert.match(markdown, /^## 2 録音内容$/m);
    assert.match(markdown, /^\| No\. \| 発言者 \| 時刻 \| 発言内容 \|$/m);
    assert.match(markdown, /^\| 1 \| 山田 \| 00:08 \| 先日の件について伺います。 \|$/m);
    assert.match(markdown, /^以上$/m);
});

test('transcribe_audio: builds general transcript markdown', () => {
    const markdown = buildGeneralTranscriptMarkdown('recording.wav', [
        { speaker: '山田', time: '00:08', text: '先日の件について伺います。' },
    ], {
        date: '令和7年1月15日 午後2時頃',
        people: '山田',
    });

    assert.match(markdown, /^# 音声認識結果$/m);
    assert.match(markdown, /^## 概要$/m);
    assert.match(markdown, /^- 音声ファイル:recording\.wav$/m);
    assert.match(markdown, /^## 文字起こし$/m);
    assert.doesNotMatch(markdown, /^以上$/m);
});

test('transcribe_audio: builds content-based transcript filename', () => {
    const result = buildTranscriptBaseName('recording.m4a', [
        { speaker: '山田', time: '00:08', text: 'お世話になります。令和6年12月5日付けで送付された文書について確認したいです。' },
    ], {
        date: '令和7年1月15日 午後2時頃',
    });

    assert.equal(result, '2025-01-15_反訳書_令和6年12月5日付けで送付された文書について確認したいです');
});

test('transcribe_audio: content-based filename switches by target', () => {
    const general = buildTranscriptBaseName('recording.m4a', [
        { speaker: '山田', time: '00:08', text: '先日の請求書について確認します。' },
    ], {
        date: '2026-01-02',
    }, 'general');

    assert.equal(general, '2026-01-02_音声認識_先日の請求書について確認します');
});

test('transcribe_audio: output path uses content-based transcript suffix', () => {
    const result = outputPathForAudio(path.join('dir', 'recording.m4a'), [
        { speaker: '山田', time: '00:08', text: '先日の請求書について確認します。' },
    ], {
        date: '2026-01-02',
    }, 'houhi');
    assert.equal(result, path.join('dir', '2026-01-02_反訳書_先日の請求書について確認します.md'));
});
