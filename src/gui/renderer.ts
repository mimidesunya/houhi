document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone') as HTMLElement;
    const consoleOutput = document.getElementById('consoleOutput') as HTMLElement;
    const toolCards = document.querySelectorAll<HTMLElement>('.tool-card');
    const progressBar = document.getElementById('progressBar') as HTMLElement;
    const dropText = document.querySelector('.drop-text') as HTMLElement;
    const dropSubtext = document.querySelector('.drop-subtext') as HTMLElement;

    let currentScript: ScriptKey = 'pdf';

    const toolDescriptions: Record<ScriptKey, string> = {
        pdf: 'Markdown/HTMLをPDFへ変換',
        renumber: 'Markdownの段落番号を整理',
        ai_archive: 'AI分析用データをZIP化',
        stamp: 'PDFに号証番号を赤字でスタンプ',
        fax_send: 'mfax経由でFAX送信'
    };

    const getScriptKey = (element: HTMLElement): ScriptKey => {
        const script = element.dataset.script as ScriptKey | undefined;
        return script || 'pdf';
    };

    const resetDropMessage = () => {
        dropText.innerText = 'ここにファイルをドロップ';
        dropSubtext.innerText = 'または クリックして選択';
    };

    const showToolDescription = (scriptKey: ScriptKey) => {
        dropText.innerText = toolDescriptions[scriptKey] || 'ここにファイルをドロップ';
        dropSubtext.innerText = '';
    };

    const executeCurrentScript = async (filePaths: string[]) => {
        if (filePaths.length === 0) {
            return;
        }

        log(`${filePaths.length} 個のファイルを処理中 (${currentScript})...`);
        setLoading(true);

        try {
            const result = await window.electronAPI.executeScript(currentScript, filePaths);
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
        const script = getScriptKey(card);

        card.addEventListener('mouseenter', () => showToolDescription(script));
        card.addEventListener('mouseleave', resetDropMessage);
        card.addEventListener('click', () => {
            toolCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            currentScript = script;
            log(`ツール変更: ${(card.querySelector('.tool-name') as HTMLElement).innerText}`);
        });
    });

    resetDropMessage();

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
