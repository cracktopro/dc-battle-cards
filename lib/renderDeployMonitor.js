/**
 * Monitor de deploy en Render: expone la versión (commit) en ejecución y consulta servicios remotos.
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '..');

async function gitRevParse(ref = 'HEAD') {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', ref], {
            cwd: REPO_ROOT,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        return String(stdout || '').trim();
    } catch (_e) {
        return '';
    }
}

function obtenerVersionDespliegueActual() {
    const commit = String(process.env.RENDER_GIT_COMMIT || '').trim();
    const rama = String(process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || '').trim();
    const url = String(process.env.RENDER_EXTERNAL_URL || '').trim();
    return {
        commit,
        commitCorto: commit ? commit.slice(0, 7) : '',
        rama: rama || null,
        url: url || null,
        esRender: Boolean(process.env.RENDER),
        serviceName: process.env.RENDER_SERVICE_NAME || null,
    };
}

async function obtenerVersionDespliegueCompleta() {
    const base = obtenerVersionDespliegueActual();
    let commit = base.commit;
    if (!commit) {
        commit = await gitRevParse('HEAD');
    }
    return {
        ...base,
        commit,
        commitCorto: commit ? commit.slice(0, 7) : '',
        ts: Date.now(),
    };
}

function obtenerConfigMonitorDespliegue() {
    const urlDev = String(process.env.RENDER_EXTERNAL_URL || '').trim() || null;
    const urlProd = String(
        process.env.RENDER_PROD_PUBLIC_URL
        || process.env.PRODUCTION_PUBLIC_URL
        || ''
    ).trim() || null;

    return {
        urlDev,
        urlProd,
        intervaloMs: Number(process.env.DEPLOY_MONITOR_INTERVAL_MS || '8000'),
        timeoutMs: Number(process.env.DEPLOY_MONITOR_TIMEOUT_MS || '900000'),
        ramaDev: String(process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || 'dev').trim(),
        ramaProd: String(process.env.GIT_PUSH_BRANCH_PROD || 'main').trim(),
        monitorDevDisponible: Boolean(process.env.RENDER || urlDev),
        monitorProdDisponible: Boolean(urlProd),
    };
}

async function consultarVersionRemota(urlBase) {
    const base = String(urlBase || '').replace(/\/$/, '');
    if (!base) {
        throw new Error('URL del servicio no configurada.');
    }
    if (typeof fetch !== 'function') {
        throw new Error('fetch no disponible en el servidor.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(`${base}/api/public/deploy-version`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

function commitCoincide(commitObservado, commitEsperado) {
    const a = String(commitObservado || '').trim().toLowerCase();
    const b = String(commitEsperado || '').trim().toLowerCase();
    if (!a || !b) {
        return false;
    }
    return a === b || a.startsWith(b) || b.startsWith(a);
}

module.exports = {
    obtenerVersionDespliegueActual,
    obtenerVersionDespliegueCompleta,
    obtenerConfigMonitorDespliegue,
    consultarVersionRemota,
    commitCoincide,
};
