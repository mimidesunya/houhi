document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const consoleOutput = document.getElementById('consoleOutput');
    const toolCards = document.querySelectorAll('.tool-card');
    const progressBar = document.getElementById('progressBar');
    
    let currentScript = 'pdf'; // Default
    let currentAiProvider = 'gemini'; // Default AI provider
    let currentProcessMode = 'sync'; // Default process mode
    let currentOcrMode = 'ai'; // ai | ndlocr_ai | ndlocr_only
    let currentPreferPdfText = false; // prefer embedded PDF text

    const AI_TOOLS = new Set(['ocr_general', 'ocr_court']);
    const isAiTool = (scriptKey) => AI_TOOLS.has(scriptKey);

    const toolDescriptions = {
        'pdf': 'Markdown/HTMLをPDFへ変換',
        'ocr_general': '画像/PDFをOCR処理',
        'ocr_court': '訴状等を定型OCR処理',
        'ocr_merge': '画像ファイルを結合',
        'renumber': 'Markdownの段落番号を整理',
        'ai_archive': 'AI分析用データ作成',
        'stamp': 'PDFに号証番号を赤字でスタンプ',
        'fax_send': 'mfax経由でFAX送信（二値化済みPDF添付）',
    };
    
    // Tool Selection Logic
    toolCards.forEach(card => {
        const script = card.dataset.script;
        
        card.addEventListener('mouseenter', () => {
             document.querySelector('.drop-text').innerText = toolDescriptions[script] || 'ここにファイルをドロップ';
             document.querySelector('.drop-subtext').innerText = '';
        });

        card.addEventListener('mouseleave', () => {
             document.querySelector('.drop-text').innerText = 'ここにファイルをドロップ';
             document.querySelector('.drop-subtext').innerText = 'または クリックして選択';
        });

        card.addEventListener('click', () => {
            // Remove active class from all
            toolCards.forEach(c => c.classList.remove('active'));
            // Add active to clicked
            card.classList.add('active');
            // Update current script
            currentScript = card.dataset.script;
            log(`ツール変更: ${card.querySelector('.tool-name').innerText}`);

            applyAiUiConstraints();
        });
    });

    // AI Provider Selection
    const aiOptions = document.querySelectorAll('.ai-option');
    const modeToggle = document.querySelector('.mode-toggle');
    const modeLabel = document.querySelector('.mode-label');
    const aiToggle = document.querySelector('.ai-toggle-provider');
    
    // Ndlocr Selection
    const ndlocrOptions = document.querySelectorAll('.ndlocr-option');
    const ndlocrToggle = document.querySelector('.ndlocr-toggle');
    const ndlocrLabel = document.querySelector('.ndlocr-label');
    const modeOptions = document.querySelectorAll('.mode-option');
    const pdfTextOptions = document.querySelectorAll('.pdftext-option');
    const pdfTextToggle = document.querySelector('.pdftext-toggle');
    const pdfTextLabel = document.querySelector('.pdftext-label');

    function updateModeToggleState() {
        // Tool-level disable takes precedence (e.g. PDF作成など)
        if (!isAiTool(currentScript)) return;

        if (currentOcrMode === 'ndlocr_only') {
            modeToggle.classList.add('disabled');
            modeLabel.classList.add('disabled');
            modeOptions.forEach(o => o.classList.add('disabled'));
            return;
        }

        if (currentAiProvider === 'claude') {
            // Claude doesn't support batch API — force sync and disable toggle
            modeToggle.classList.add('disabled');
            modeLabel.classList.add('disabled');
            modeOptions.forEach(o => {
                o.classList.remove('active');
                o.classList.add('disabled');
            });
            // Force sync mode
            const syncBtn = document.querySelector('.mode-option[data-mode="sync"]');
            if (syncBtn) {
                syncBtn.classList.add('active');
                syncBtn.classList.remove('disabled');
            }
            currentProcessMode = 'sync';
        } else {
            modeToggle.classList.remove('disabled');
            modeLabel.classList.remove('disabled');
            modeOptions.forEach(o => o.classList.remove('disabled'));
        }
    }

    function applyAiUiConstraints() {
        const enabled = isAiTool(currentScript);
        const aiEnabled = enabled && currentOcrMode !== 'ndlocr_only';

        // Provider buttons
        aiOptions.forEach(o => o.classList.toggle('disabled', !aiEnabled));

        // Mode buttons + label
        modeLabel.classList.toggle('disabled', !aiEnabled);
        modeToggle.classList.toggle('disabled', !aiEnabled);
        modeOptions.forEach(o => o.classList.toggle('disabled', !aiEnabled));

        // Visual grouping
        if (aiToggle) aiToggle.classList.toggle('disabled', !aiEnabled);

        // Ndlocr buttons + label
        if (ndlocrLabel) ndlocrLabel.classList.toggle('disabled', !enabled);
        if (ndlocrToggle) ndlocrToggle.classList.toggle('disabled', !enabled);
        if (ndlocrOptions) ndlocrOptions.forEach(o => o.classList.toggle('disabled', !enabled));

        // PDF text preference buttons + label
        if (pdfTextLabel) pdfTextLabel.classList.toggle('disabled', !enabled);
        if (pdfTextToggle) pdfTextToggle.classList.toggle('disabled', !enabled);
        if (pdfTextOptions) pdfTextOptions.forEach(o => o.classList.toggle('disabled', !enabled));

        // When enabled, apply provider-specific constraints (Claude forces sync)
        if (enabled) {
            updateModeToggleState();
        }
    }

    aiOptions.forEach(option => {
        option.addEventListener('click', () => {
            if (option.classList.contains('disabled')) return;

            aiOptions.forEach(o => o.classList.remove('active'));
            option.classList.add('active');
            currentAiProvider = option.dataset.ai;
            log(`AIプロバイダー変更: ${currentAiProvider}`);
            updateModeToggleState();
        });
    });

    if (ndlocrOptions) {
        ndlocrOptions.forEach(option => {
            option.addEventListener('click', () => {
                if (option.classList.contains('disabled')) return;

                ndlocrOptions.forEach(o => o.classList.remove('active'));
                option.classList.add('active');
                currentOcrMode = option.dataset.ocrMode || 'ai';
                if (currentOcrMode === 'ndlocr_ai') {
                    log('OCRエンジン変更: ndlocr+AI');
                } else if (currentOcrMode === 'ndlocr_only') {
                    log('OCRエンジン変更: ndlocr-only');
                } else {
                    log('OCRエンジン変更: AIのみ');
                }
                applyAiUiConstraints();
            });
        });
    }

    if (pdfTextOptions) {
        pdfTextOptions.forEach(option => {
            option.addEventListener('click', () => {
                if (option.classList.contains('disabled')) return;

                pdfTextOptions.forEach(o => o.classList.remove('active'));
                option.classList.add('active');
                currentPreferPdfText = option.dataset.pdftext === 'true';
                log(`PDFテキスト優先: ${currentPreferPdfText ? 'On' : 'Off'}`);
            });
        });
    }

    // Process Mode Selection
    modeOptions.forEach(option => {
        option.addEventListener('click', () => {
            if (option.classList.contains('disabled')) return;

            modeOptions.forEach(o => o.classList.remove('active'));
            option.classList.add('active');
            currentProcessMode = option.dataset.mode;
            log(`処理モード変更: ${currentProcessMode === 'sync' ? '同期' : 'バッチ'}`);
        });
    });

    // Initial state (default tool is PDF)
    applyAiUiConstraints();

    // Drag and Drop Events
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

        const files = Array.from(e.dataTransfer.files).map(f => window.electronAPI.getPathForFile(f));
        
        if (files.length === 0) return;

        log(`Processing ${files.length} file(s) with ${currentScript}...`);
        setLoading(true);

        try {
            const result = await window.electronAPI.executeScript(currentScript, files, currentAiProvider, currentProcessMode, currentOcrMode, currentPreferPdfText);
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
    });

    // Click to select files (simulated input)
    dropZone.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = async (e) => {
            const files = Array.from(e.target.files).map(f => window.electronAPI.getPathForFile(f));
            if(files.length > 0) {
                log(`${files.length} 個のファイルを処理中 (${currentScript})...`);
                setLoading(true);
                try {
                    const result = await window.electronAPI.executeScript(currentScript, files, currentAiProvider, currentProcessMode, currentOcrMode, currentPreferPdfText);
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
            }
        };
        input.click();
    });

    // Logging helpers
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
        
        // Handling newlines for better readable output
        message.split('\n').forEach(subMsg => {
            if(subMsg.trim() !== '') {
                const subLine = line.cloneNode();
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
