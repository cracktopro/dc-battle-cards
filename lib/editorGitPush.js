/**
 * Git push desde editores internos (episodios JSON / cartas.xlsx).
 * Requiere GIT_PUSH_TOKEN en el servidor (PAT de GitHub con permiso de escritura).
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '..');

function esRamaDevRender() {
    const branch = String(process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || '').trim().toLowerCase();
    return branch === 'dev';
}

function editoresInternosPermitidos() {
    return process.env.EPISODIOS_EDITOR === '1'
        || process.env.CARTAS_EDITOR === '1'
        || process.env.NODE_ENV !== 'production'
        || esRamaDevRender();
}

function episodiosEditorPermitido() {
    return process.env.EPISODIOS_EDITOR === '1'
        || process.env.NODE_ENV !== 'production'
        || esRamaDevRender();
}

function cartasEditorPermitido() {
    return process.env.CARTAS_EDITOR === '1'
        || process.env.EPISODIOS_EDITOR === '1'
        || process.env.NODE_ENV !== 'production'
        || esRamaDevRender();
}

function obtenerRamaGitPush() {
    return String(
        process.env.GIT_PUSH_BRANCH
        || process.env.RENDER_GIT_BRANCH
        || process.env.GIT_BRANCH
        || 'dev'
    ).trim() || 'dev';
}

function gitPushPermitido() {
    if (process.env.GIT_PUSH_ENABLED === '0') {
        return false;
    }
    if (!String(process.env.GIT_PUSH_TOKEN || '').trim()) {
        return false;
    }
    return editoresInternosPermitidos();
}

function gitPushEstado() {
    return {
        habilitado: gitPushPermitido(),
        rama: obtenerRamaGitPush(),
        requiereTokenCliente: Boolean(String(process.env.GIT_PUSH_SECRET || '').trim()),
        ramaDevRender: esRamaDevRender(),
    };
}

function verificarGitPushAuth(req) {
    const secret = String(process.env.GIT_PUSH_SECRET || '').trim();
    if (!secret) {
        return true;
    }
    const provided = String(
        req.headers['x-editor-git-token']
        || req.body?.token
        || ''
    ).trim();
    return provided === secret;
}

async function ejecutarGit(args, opts = {}) {
    const { stdout, stderr } = await execFileAsync('git', args, {
        cwd: REPO_ROOT,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        ...opts,
    });
    return { stdout: String(stdout || ''), stderr: String(stderr || '') };
}

function repoGitDisponible() {
    return fs.existsSync(path.join(REPO_ROOT, '.git'));
}

async function configurarIdentidadGit() {
    const email = String(process.env.GIT_USER_EMAIL || 'dc-battle-cards-editor@users.noreply.github.com').trim();
    const name = String(process.env.GIT_USER_NAME || 'DC Battle Cards Editor').trim();
    await ejecutarGit(['config', 'user.email', email]);
    await ejecutarGit(['config', 'user.name', name]);
}

function construirRemoteAutenticado() {
    const token = String(process.env.GIT_PUSH_TOKEN || '').trim();
    const repoUrl = String(
        process.env.GIT_PUSH_REPO_URL
        || 'https://github.com/cracktopro/dc-battle-cards.git'
    ).trim();
    if (!token) {
        throw new Error('GIT_PUSH_TOKEN no configurado en el servidor.');
    }
    return repoUrl.replace(/^https:\/\//, `https://x-access-token:${encodeURIComponent(token)}@`);
}

async function gitPushArchivos({ rutas, mensaje }) {
    if (!gitPushPermitido()) {
        throw new Error('Git push no habilitado en este entorno.');
    }
    if (!repoGitDisponible()) {
        throw new Error('El repositorio git no está disponible en este despliegue.');
    }
    const paths = (rutas || []).map((p) => String(p || '').trim()).filter(Boolean);
    if (!paths.length) {
        throw new Error('No hay rutas para subir.');
    }

    await configurarIdentidadGit();

    for (const rel of paths) {
        const abs = path.resolve(REPO_ROOT, rel);
        const relNorm = path.relative(REPO_ROOT, abs);
        if (relNorm.startsWith('..') || path.isAbsolute(relNorm)) {
            throw new Error(`Ruta no permitida: ${rel}`);
        }
        if (!fs.existsSync(abs)) {
            throw new Error(`No existe el archivo: ${rel}`);
        }
        await ejecutarGit(['add', '--', relNorm.replace(/\\/g, '/')]);
    }

    const status = await ejecutarGit(['status', '--porcelain', '--', ...paths.map((p) => p.replace(/\\/g, '/'))]);
    if (!status.stdout.trim()) {
        return {
            ok: true,
            sinCambios: true,
            rama: obtenerRamaGitPush(),
            mensaje: 'No hay cambios pendientes respecto al último commit.',
        };
    }

    const commitMsg = String(mensaje || '').trim() || `editor: actualizar ${paths.join(', ')}`;
    await ejecutarGit(['commit', '-m', commitMsg]);

    const branch = obtenerRamaGitPush();
    const remoteAuth = construirRemoteAutenticado();
    await ejecutarGit(['push', remoteAuth, `HEAD:${branch}`]);

    const resumen = await ejecutarGit(['log', '-1', '--oneline']);
    return {
        ok: true,
        sinCambios: false,
        rama: branch,
        commit: resumen.stdout.trim(),
        archivos: paths,
    };
}

async function gitPushEpisodios(mensaje) {
    const dir = path.join(REPO_ROOT, 'public', 'resources', 'episodios');
    const jsonFiles = fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && /\.json$/i.test(d.name))
        .map((d) => path.join('public', 'resources', 'episodios', d.name).replace(/\\/g, '/'));
    if (!jsonFiles.length) {
        throw new Error('No hay archivos JSON de episodios.');
    }
    return gitPushArchivos({
        rutas: jsonFiles,
        mensaje: mensaje || 'editor episodios: actualizar JSON de episodios',
    });
}

async function gitPushCartas(mensaje) {
    return gitPushArchivos({
        rutas: ['public/resources/cartas.xlsx'],
        mensaje: mensaje || 'editor cartas: actualizar cartas.xlsx',
    });
}

module.exports = {
    esRamaDevRender,
    episodiosEditorPermitido,
    cartasEditorPermitido,
    gitPushPermitido,
    gitPushEstado,
    verificarGitPushAuth,
    gitPushEpisodios,
    gitPushCartas,
};
