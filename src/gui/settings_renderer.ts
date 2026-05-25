type ConfigMap = Record<string, any>;

let loadedConfig: ConfigMap = {};

function byId<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing element: ${id}`);
    }
    return element as T;
}

function input(id: string) {
    return byId<HTMLInputElement>(id);
}

function textarea(id: string) {
    return byId<HTMLTextAreaElement>(id);
}

function status(message: string, type: 'normal' | 'ok' | 'error' = 'normal') {
    const statusEl = byId('status');
    statusEl.textContent = message;
    statusEl.classList.toggle('ok', type === 'ok');
    statusEl.classList.toggle('error', type === 'error');
}

function asObject(value: any): ConfigMap {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function setValue(id: string, value: any) {
    input(id).value = value == null ? '' : String(value);
}

function setChecked(id: string, value: any) {
    input(id).checked = Boolean(value);
}

function readPort(id: string) {
    const raw = input(id).value.trim();
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
        throw new Error(`${id} は 1 から 65535 の整数で入力してください。`);
    }
    return value;
}

function parseProperties() {
    const raw = textarea('copperProperties').value.trim();
    if (raw === '') {
        return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('追加プロパティ JSON はオブジェクトで入力してください。');
    }
    return parsed;
}

function fillForm(config: ConfigMap) {
    const copper = asObject(config.copper);
    const copperProperties = asObject(copper.properties);
    const mail = asObject(config.mail);
    const smtp = asObject(mail.smtp);
    const imap = asObject(mail.imap);
    const mfax = asObject(config.mfax);

    setValue('copperServerUri', copper.serverUri);
    setValue('copperUser', copper.user);
    setValue('copperPassword', copper.password);
    textarea('copperProperties').value = JSON.stringify(copperProperties, null, 4);

    setValue('mailUser', mail.user);
    setValue('mailPassword', mail.password);

    setValue('smtpHost', smtp.host);
    setValue('smtpPort', smtp.port);
    setChecked('smtpSecure', smtp.secure);
    setValue('smtpTls', smtp.tlsMinVersion);

    setValue('imapHost', imap.host);
    setValue('imapPort', imap.port);
    setChecked('imapSecure', imap.secure);
    setValue('imapTls', imap.tlsMinVersion);

    setValue('mfaxSendPassword', mfax.sendPassword);
    setValue('mfaxFromAddress', mfax.fromAddress);
    setValue('mfaxSelfFax', mfax.selfFax);
}

function buildConfigFromForm() {
    const config = { ...loadedConfig };
    const copper = { ...asObject(config.copper) };
    const mail = { ...asObject(config.mail) };
    const smtp = { ...asObject(mail.smtp) };
    const imap = { ...asObject(mail.imap) };
    const mfax = { ...asObject(config.mfax) };

    copper.serverUri = input('copperServerUri').value.trim();
    copper.user = input('copperUser').value.trim();
    copper.password = input('copperPassword').value;
    copper.properties = parseProperties();

    mail.user = input('mailUser').value.trim();
    mail.password = input('mailPassword').value;

    smtp.host = input('smtpHost').value.trim();
    smtp.port = readPort('smtpPort');
    smtp.secure = input('smtpSecure').checked;
    smtp.tlsMinVersion = input('smtpTls').value.trim() || 'TLSv1.2';

    imap.host = input('imapHost').value.trim();
    imap.port = readPort('imapPort');
    imap.secure = input('imapSecure').checked;
    imap.tlsMinVersion = input('imapTls').value.trim() || 'TLSv1.2';

    mfax.sendPassword = input('mfaxSendPassword').value;
    mfax.fromAddress = input('mfaxFromAddress').value.trim();
    mfax.selfFax = input('mfaxSelfFax').value.trim();

    mail.smtp = smtp;
    mail.imap = imap;
    config.copper = copper;
    config.mail = mail;
    config.mfax = mfax;

    return config;
}

async function loadConfig() {
    status('設定を読み込んでいます。');
    const result = await window.electronAPI.getConfigForEditor();
    loadedConfig = result.config || {};
    byId('configPath').textContent = result.configPath || '(未決定)';
    byId('configPath').setAttribute('title', result.configPath || '');
    fillForm(loadedConfig);

    if (result.parseError) {
        status(`config.json の解析に失敗しました。保存すると現在のフォーム内容で上書きします: ${result.parseError}`, 'error');
    } else if (result.created && result.createdFromTemplate) {
        status('config.template.json から config.json を作成しました。', 'ok');
    } else if (result.created) {
        status('既定値で config.json を作成しました。', 'ok');
    } else {
        status('設定を読み込みました。', 'ok');
    }
}

async function saveConfig() {
    try {
        const saveButton = byId<HTMLButtonElement>('saveButton');
        saveButton.disabled = true;
        status('保存しています。');

        const config = buildConfigFromForm();
        const result = await window.electronAPI.saveConfigFromEditor(config);
        loadedConfig = result.config || config;
        byId('configPath').textContent = result.configPath || '(未決定)';
        status('保存しました。', 'ok');
    } catch (err) {
        status(err instanceof Error ? err.message : String(err), 'error');
    } finally {
        byId<HTMLButtonElement>('saveButton').disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    byId('reloadButton').addEventListener('click', () => {
        loadConfig().catch(err => status(err instanceof Error ? err.message : String(err), 'error'));
    });
    byId('saveButton').addEventListener('click', () => {
        saveConfig();
    });

    loadConfig().catch(err => status(err instanceof Error ? err.message : String(err), 'error'));
});
