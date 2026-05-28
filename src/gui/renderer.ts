document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone') as HTMLElement;
    const consoleOutput = document.getElementById('consoleOutput') as HTMLElement;
    const toolCards = document.querySelectorAll<HTMLElement>('.tool-card');
    const progressBar = document.getElementById('progressBar') as HTMLElement;
    const dropText = document.querySelector('.drop-text') as HTMLElement;
    const dropSubtext = document.querySelector('.drop-subtext') as HTMLElement;
    const optionsBar = document.getElementById('optionsBar') as HTMLElement;
    const pdfEngineOption = document.getElementById('pdfEngineOption') as HTMLElement;
    const optPdfEngine = document.getElementById('optPdfEngine') as HTMLSelectElement;
    const optNoBlankPages = document.getElementById('optNoBlankPages') as HTMLInputElement;
    const optNoDither = document.getElementById('optNoDither') as HTMLInputElement;

    let currentScript: ScriptKey = 'pdf';
    type ToolCardKey = ScriptKey | 'drafting' | 'settings';
    type GuiState = {
        currentScript?: ScriptKey;
        pdfEngine?: string;
        noBlankPages?: boolean;
        noDither?: boolean;
    };

    const GUI_STATE_KEY = 'houhi.gui.state.v1';
    const DEFAULT_PDF_ENGINE = 'chrome';

    const toolDescriptions: Record<ToolCardKey, string> = {
        pdf: 'Markdown/HTMLをPDFへ変換',
        ai_archive: 'AI分析用データをZIP化',
        stamp: 'PDFに号証番号を赤字でスタンプ',
        fax_send: 'mfax経由でFAX送信',
        drafting: 'ChatGPT用の起案キットを開く',
        settings: 'config.jsonを編集'
    };

    const getToolCardKey = (element: HTMLElement): ToolCardKey => {
        const action = element.dataset.action as ToolCardKey | undefined;
        const script = element.dataset.script as ScriptKey | undefined;
        return action || script || 'pdf';
    };

    const getScriptKey = (element: HTMLElement): ScriptKey | null => {
        return (element.dataset.script as ScriptKey | undefined) || null;
    };

    const isScriptKey = (value: any): value is ScriptKey => {
        return value === 'pdf' || value === 'ai_archive' || value === 'stamp' || value === 'fax_send';
    };

    const isPdfEngine = (value: any) => value === 'chrome' || value === 'copper';

    const loadGuiState = (): GuiState => {
        try {
            const raw = localStorage.getItem(GUI_STATE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_err) {
            return {};
        }
    };

    const saveGuiState = () => {
        const state: GuiState = {
            currentScript,
            pdfEngine: optPdfEngine.value || DEFAULT_PDF_ENGINE,
            noBlankPages: optNoBlankPages.checked,
            noDither: optNoDither.checked,
        };
        localStorage.setItem(GUI_STATE_KEY, JSON.stringify(state));
    };

    const savedState = loadGuiState();

    const updateOptionsVisibility = (scriptKey: ScriptKey) => {
        optionsBar.style.display = (scriptKey === 'pdf' || scriptKey === 'stamp' || scriptKey === 'fax_send') ? '' : 'none';
        pdfEngineOption.style.display = scriptKey === 'pdf' ? '' : 'none';
        optNoBlankPages.parentElement!.style.display = scriptKey === 'stamp' ? '' : 'none';
        optNoDither.parentElement!.style.display = scriptKey === 'fax_send' ? '' : 'none';
    };

    const getScriptOptions = (): string[] => {
        const opts: string[] = [];
        if (currentScript === 'pdf') {
            opts.push(`--pdf-engine=${optPdfEngine.value || DEFAULT_PDF_ENGINE}`);
        }
        if (currentScript === 'stamp' && optNoBlankPages.checked) {
            opts.push('--no-blank-pages');
        }
        if (currentScript === 'fax_send' && optNoDither.checked) {
            opts.push('--no-dither');
        }
        return opts;
    };

    const resetDropMessage = () => {
        dropText.innerText = 'ここにファイルをドロップ';
        dropSubtext.innerText = 'または クリックして選択';
    };

    const showCardDescription = (toolKey: ToolCardKey) => {
        dropText.innerText = toolDescriptions[toolKey] || 'ここにファイルをドロップ';
        if (toolKey === 'drafting') {
            dropSubtext.innerText = 'クリックでZIPの場所と使い方を表示';
        } else if (toolKey === 'settings') {
            dropSubtext.innerText = 'クリックで設定画面を開く';
        } else {
            dropSubtext.innerText = 'ここへ直接ドロップして実行';
        }
    };

    const selectToolCard = (card: HTMLElement, script: ScriptKey) => {
        toolCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        currentScript = script;
        updateOptionsVisibility(script);
        saveGuiState();
    };

    const openSettings = async () => {
        try {
            await window.electronAPI.openConfigSettings();
        } catch (err) {
            log(`設定画面を開けませんでした: ${err.message}`, 'error');
        }
    };

    const openDraftingKit = async () => {
        try {
            const result = await window.electronAPI.openDraftingKitFolder();

            if (result.openError) {
                log(`起案キットのフォルダを開けませんでした: ${result.openError}`, 'error');
                return;
            }

            if (!result.exists) {
                log(`${result.fileName} が見つかりません。npm run setup を実行すると作成できます。`, 'error');
                log(`確認先フォルダ: ${result.folderPath}`);
                return;
            }

            log(`起案キットをエクスプローラーで表示しました: ${result.zipPath}`, 'success');
            log([
                'ChatGPTでの使い方:',
                `1. 開いたフォルダの ${result.fileName} をChatGPTにアップロードします。`,
                '2. アップロード時に、次の指示文もChatGPTに送ってください。',
                '---',
                `添付した ${result.fileName} を読み込み、まず 00_START_HERE.md の指示に従ってください。私がこのメッセージで「訴状を起案してほしい」などの具体的な要望を書いている場合は、その要望を優先してください。具体的な要望がない場合は、法匪の書面起案アシスタントとして自己紹介し、何の書面を作成したいか私に質問してください。`,
                '---',
                '3. すぐ依頼したい場合は、上の指示文に続けて「訴状を起案してほしい」のような要望を書き足してかまいません。',
                '4. ChatGPTが質問してきたら、事件資料、OCR結果、当事者情報、事件番号、請求内容、証拠番号などを伝えます。',
                '5. Markdown原案ができたら .md ファイルとして保存し、法匪の「PDF作成」へドロップするとPDFにできます。'
            ].join('\n'));
        } catch (err) {
            log(`起案キットを開けませんでした: ${err.message}`, 'error');
        }
    };

    const getDroppedFilePaths = (event: DragEvent): string[] => {
        return Array.from(event.dataTransfer?.files || []).map(f => window.electronAPI.getPathForFile(f));
    };

    const executeCurrentScript = async (filePaths: string[]) => {
        if (filePaths.length === 0) {
            return;
        }

        const options = getScriptOptions();
        log(`${filePaths.length} 個のファイルを処理中 (${currentScript})...`);
        setLoading(true);

        try {
            const result = await window.electronAPI.executeScript(currentScript, filePaths, options);
            if (result.success) {
                log('処理が正常に完了しました。', 'success');
            } else {
                log(`処理失敗 (コード: ${result.code})`, 'error');
            }
        } catch (err) {
            log(`エラー: ${err.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    toolCards.forEach(card => {
        const toolKey = getToolCardKey(card);
        const script = getScriptKey(card);

        card.addEventListener('mouseenter', () => showCardDescription(toolKey));
        card.addEventListener('mouseleave', resetDropMessage);
        card.addEventListener('click', async () => {
            if (toolKey === 'drafting') {
                await openDraftingKit();
                return;
            }

            if (!script) {
                await openSettings();
                return;
            }

            selectToolCard(card, script);
            log(`ツール変更: ${(card.querySelector('.tool-name') as HTMLElement).innerText}`);
        });

        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            card.classList.add('drag-over');
        });

        card.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            card.classList.remove('drag-over');
        });

        card.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            card.classList.remove('drag-over');

            if (toolKey === 'drafting') {
                await openDraftingKit();
                return;
            }

            if (!script) {
                await openSettings();
                return;
            }

            selectToolCard(card, script);
            log(`ツール変更: ${(card.querySelector('.tool-name') as HTMLElement).innerText}`);
            await executeCurrentScript(getDroppedFilePaths(e));
        });
    });

    if (isPdfEngine(savedState.pdfEngine)) {
        optPdfEngine.value = savedState.pdfEngine;
    } else {
        optPdfEngine.value = DEFAULT_PDF_ENGINE;
    }
    optNoBlankPages.checked = Boolean(savedState.noBlankPages);
    optNoDither.checked = Boolean(savedState.noDither);

    const restoredScript = isScriptKey(savedState.currentScript) ? savedState.currentScript : currentScript;
    const restoredCard = Array.from(toolCards).find(card => getScriptKey(card) === restoredScript);
    if (restoredCard) {
        selectToolCard(restoredCard, restoredScript);
    } else {
        updateOptionsVisibility(currentScript);
        saveGuiState();
    }
    resetDropMessage();

    optPdfEngine.addEventListener('change', saveGuiState);
    optNoBlankPages.addEventListener('change', saveGuiState);
    optNoDither.addEventListener('change', saveGuiState);
    window.addEventListener('beforeunload', saveGuiState);

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');

        const files = getDroppedFilePaths(e);
        await executeCurrentScript(files);
    });

    dropZone.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = async (e) => {
            const target = e.target as HTMLInputElement | null;
            const files = Array.from(target?.files || []).map(f => window.electronAPI.getPathForFile(f));
            await executeCurrentScript(files);
        };
        input.click();
    });

    window.electronAPI.getConfigForEditor().then(result => {
        if (isPdfEngine(savedState.pdfEngine)) {
            return;
        }
        const engine = String(result.config?.pdf?.engine || '').toLowerCase();
        if (engine === 'chrome' || engine === 'copper') {
            optPdfEngine.value = engine;
            saveGuiState();
        }
    }).catch(() => {
        // 設定が読めない場合は画面上の既定値を使います。
    });

    window.electronAPI.onLog((msg) => {
        log(msg);
    });

    window.electronAPI.onError((msg) => {
        log(msg, 'error');
    });

    function log(message, type = 'normal') {
        const line = document.createElement('div');
        line.classList.add('log-line');
        if (type === 'error') line.classList.add('log-error');
        if (type === 'success') line.classList.add('log-success');

        message.split('\n').forEach(subMsg => {
            if (subMsg.trim() !== '') {
                const subLine = line.cloneNode() as HTMLElement;
                subLine.innerText = subMsg;
                consoleOutput.appendChild(subLine);
            }
        });

        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    function setLoading(isLoading) {
        if (isLoading) {
            progressBar.style.width = '100%';
            progressBar.classList.add('loading');
        } else {
            progressBar.style.width = '0%';
            setTimeout(() => progressBar.classList.remove('loading'), 300);
        }
    }
});
