document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const consoleOutput = document.getElementById('consoleOutput');
    const toolCards = document.querySelectorAll('.tool-card');
    const progressBar = document.getElementById('progressBar');
    
    let currentScript = 'pdf'; // Default

    const toolDescriptions = {
        'pdf': 'Markdown/HTMLをPDFへ変換',
        'ocr_general': '画像/PDFをOCR処理',
        'ocr_court': '訴状等を定型OCR処理',
        'ocr_merge': '画像ファイルを結合',
        'renumber': 'Markdownの段落番号を整理',
        'ai_draft': 'AIによる起案作成',
        'ai_archive': 'AI分析用データ作成',
        'preview': 'テンプレートプレビュー'
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
        });
    });

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
            const result = await window.electronAPI.executeScript(currentScript, files);
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
                    const result = await window.electronAPI.executeScript(currentScript, files);
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
