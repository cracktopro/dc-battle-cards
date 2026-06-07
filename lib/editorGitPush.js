/**
 * Git push desde editores internos (episodios JSON / cartas.xlsx).
 * Requiere GIT_PUSH_TOKEN en el servidor (PAT de GitHub con permiso de escritura).
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const DCEditorXlsxSeguro = require('./editorXlsxSeguro.js');

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '..');

const RUTAS_PERFIL_XLSX = {
    'public/resources/cartas.xlsx': 'cartas',
    'public/resources/desafios.xlsx': 'desafios',
    'public/resources/asaltos.xlsx': 'asaltos',
    'public/resources/eventos.xlsx': 'eventos',
    'public/resources/eventos_online.xlsx': 'eventos_online',
    'public/resources/skins.xlsx': 'skins',
};

function validarArchivoEditorAntesDeGitPush(rel) {
    const relNorm = String(rel || '').replace(/\\/g, '/');
    const perfilKey = RUTAS_PERFIL_XLSX[relNorm];
    if (!perfilKey) {
        return;
    }
    const abs = path.resolve(REPO_ROOT, relNorm);
    DCEditorXlsxSeguro.validarPerfilAntesDeGitPush(perfilKey, abs);
}

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
        validarArchivoEditorAntesDeGitPush(relNorm.replace(/\\/g, '/'));
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

    const commitSha = (await ejecutarGit(['rev-parse', 'HEAD'])).stdout.trim();
    const branch = obtenerRamaGitPush();
    const remoteAuth = construirRemoteAutenticado();
    await ejecutarGit(['push', remoteAuth, `HEAD:${branch}`]);

    const resumen = await ejecutarGit(['log', '-1', '--oneline']);
    return {
        ok: true,
        sinCambios: false,
        rama: branch,
        commit: resumen.stdout.trim(),
        commitSha,
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

async function gitPushDesafios(mensaje) {
    return gitPushArchivos({
        rutas: rutasRelativasDesafios(),
        mensaje: mensaje || 'editor desafios: actualizar desafios.xlsx',
    });
}

function rutasRelativasEpisodiosJson() {
    const dir = path.join(REPO_ROOT, 'public', 'resources', 'episodios');
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isFile() && /\.json$/i.test(d.name))
            .map((d) => path.join('public', 'resources', 'episodios', d.name).replace(/\\/g, '/'));
    } catch (_e) {
        return [];
    }
}

function rutasRelativasCartas() {
    return ['public/resources/cartas.xlsx'];
}

function rutasRelativasDesafios() {
    return ['public/resources/desafios.xlsx'];
}

function rutasRelativasAsaltos() {
    return ['public/resources/asaltos.xlsx'];
}

function rutasRelativasEventos() {
    return ['public/resources/eventos.xlsx'];
}

function rutasRelativasEventosOnline() {
    return ['public/resources/eventos_online.xlsx'];
}

function rutasRelativasSkins() {
    return ['public/resources/skins.xlsx'];
}

function rutasRelativasEditorTodas() {
    return [
        ...rutasRelativasCartas(),
        ...rutasRelativasDesafios(),
        ...rutasRelativasAsaltos(),
        ...rutasRelativasEventos(),
        ...rutasRelativasEventosOnline(),
        ...rutasRelativasSkins(),
        ...rutasRelativasEpisodiosJson(),
    ];
}

function normalizarRutaEditorRelativa(rel) {
    return String(rel || '').trim().replace(/\\/g, '/');
}

function esRutaEditorPermitida(rel) {
    const norm = normalizarRutaEditorRelativa(rel);
    return rutasRelativasEditorTodas().some((p) => normalizarRutaEditorRelativa(p) === norm);
}

function validarRutasEditorPermitidas(rutas) {
    const out = (rutas || []).map((r) => normalizarRutaEditorRelativa(r)).filter(Boolean);
    for (const rel of out) {
        if (!esRutaEditorPermitida(rel)) {
            throw new Error(`Ruta no permitida para despliegue: ${rel}`);
        }
    }
    return out;
}

function obtenerRamaGitPushProduccion() {
    return String(process.env.GIT_PUSH_BRANCH_PROD || 'main').trim() || 'main';
}

function gitPushProduccionPermitido() {
    if (process.env.GIT_PUSH_PROD_ENABLED === '0') {
        return false;
    }
    if (!gitPushPermitido()) {
        return false;
    }
    return esRamaDevRender();
}

async function refGitExiste(ref) {
    try {
        await ejecutarGit(['rev-parse', '--verify', ref]);
        return true;
    } catch (_e) {
        return false;
    }
}

async function fetchRamaRemota(rama) {
    const ramaNorm = String(rama || '').trim();
    if (!ramaNorm) {
        return null;
    }
    const refRemoto = `origin/${ramaNorm}`;
    const refspec = `refs/heads/${ramaNorm}:refs/remotes/origin/${ramaNorm}`;

    async function intentarFetch(args) {
        try {
            await ejecutarGit(args);
            return (await refGitExiste(refRemoto)) ? refRemoto : null;
        } catch (_e) {
            return null;
        }
    }

    if (gitPushPermitido()) {
        try {
            const remoteAuth = construirRemoteAutenticado();
            const ok = await intentarFetch(['fetch', '--force', remoteAuth, refspec]);
            if (ok) {
                return ok;
            }
            const okSimple = await intentarFetch(['fetch', '--force', remoteAuth, ramaNorm]);
            if (okSimple) {
                return okSimple;
            }
        } catch (_e) { /* fallback origin */ }
    }

    const okOrigin = await intentarFetch(['fetch', '--force', 'origin', refspec]);
    if (okOrigin) {
        return okOrigin;
    }
    return intentarFetch(['fetch', '--force', 'origin', ramaNorm]);
}

async function nombresArchivosDiffGit(base, head, paths) {
    try {
        const diff = await ejecutarGit(['diff', '--name-only', base, head, '--', ...paths]);
        return diff.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch (err) {
        const out = String(err.stdout || '').trim();
        if (out) {
            return out.split('\n').map((s) => s.trim()).filter(Boolean);
        }
        return [];
    }
}

async function nombresArchivosDiffTresPuntosGit(base, head, paths) {
    try {
        const diff = await ejecutarGit(['diff', '--name-only', `${base}...${head}`, '--', ...paths]);
        return diff.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch (_err) {
        return [];
    }
}

async function agregarArchivosLocalesPendientes(archivos, pathsTotales) {
    const status = await ejecutarGit(['status', '--porcelain', '--', ...pathsTotales]);
    status.stdout.split('\n').forEach((line) => {
        const p = line.slice(3).trim().replace(/\\/g, '/');
        if (p && pathsTotales.includes(p)) {
            archivos.add(p);
        }
    });
}

async function listarArchivosEditorPendientesProduccion() {
    const pathsTotales = rutasRelativasEditorTodas().map(normalizarRutaEditorRelativa);
    const ramaProd = obtenerRamaGitPushProduccion();
    const ramaDev = obtenerRamaGitPush();

    if (!repoGitDisponible()) {
        return {
            archivos: [],
            pathsTotales,
            ramaProduccion: ramaProd,
            ramaDev,
            comparacion: null,
        };
    }

    const archivos = new Set();
    const refProd = await fetchRamaRemota(ramaProd);
    const refDev = await fetchRamaRemota(ramaDev);
    const refDevEfectivo = refDev || ((await refGitExiste('HEAD')) ? 'HEAD' : null);

    // GitHub dev vs GitHub main (fuente principal tras «Subir a GitHub»)
    if (refProd && refDev) {
        (await nombresArchivosDiffGit(refProd, refDev, pathsTotales)).forEach((p) => archivos.add(p));
        (await nombresArchivosDiffTresPuntosGit(refProd, refDev, pathsTotales)).forEach((p) => archivos.add(p));
    }

    // Disco / HEAD local vs main (cambios guardados en Render aún no reflejados en origin/dev)
    if (refProd && refDevEfectivo) {
        (await nombresArchivosDiffGit(refProd, refDevEfectivo, pathsTotales)).forEach((p) => archivos.add(p));
    }

    await agregarArchivosLocalesPendientes(archivos, pathsTotales);

    return {
        archivos: [...archivos].sort(),
        pathsTotales,
        ramaProduccion: ramaProd,
        ramaDev,
        comparacion: refProd && refDev
            ? `${ramaProd} (GitHub) vs ${ramaDev} (GitHub)`
            : (refProd && refDevEfectivo ? `${ramaProd} (GitHub) vs HEAD local` : null),
    };
}

function resolverRamaTrabajoGit() {
    const ramaRender = String(process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || '').trim();
    return ramaRender || obtenerRamaGitPush();
}

async function obtenerRamaActualGit() {
    const ref = (await ejecutarGit(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    if (ref && ref !== 'HEAD') {
        return ref;
    }
    return resolverRamaTrabajoGit();
}

/**
 * Sale de la rama temporal deploy-prod-* y la elimina.
 * En Render el repo suele estar en HEAD detached; «git checkout HEAD» no cambia de rama
 * y falla «git branch -D» si la temp sigue checked out.
 */
async function salirDeRamaTempDeploy({ tempBranch, shaAntes, ramaAntes }) {
    const ramaDev = resolverRamaTrabajoGit();
    const refOriginDev = `origin/${ramaDev}`;

    async function intentarCheckout(ref) {
        if (!ref || ref === 'HEAD' || ref === tempBranch) {
            return false;
        }
        if (!(await refGitExiste(ref))) {
            return false;
        }
        await ejecutarGit(['checkout', '-f', ref]);
        return true;
    }

    let salido = false;
    for (const ref of [ramaAntes, ramaDev, refOriginDev]) {
        try {
            if (await intentarCheckout(ref)) {
                salido = true;
                break;
            }
        } catch (_e) { /* probar siguiente ref */ }
    }

    if (!salido && shaAntes) {
        await ejecutarGit(['checkout', '--detach', shaAntes]);
        salido = true;
    }

    let enRama = (await ejecutarGit(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    if (enRama === tempBranch && shaAntes) {
        await ejecutarGit(['checkout', '--detach', shaAntes]);
    }

    try {
        await ejecutarGit(['branch', '-D', tempBranch]);
    } catch (e) {
        enRama = (await ejecutarGit(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
        if (enRama === tempBranch && shaAntes) {
            await ejecutarGit(['checkout', '--detach', shaAntes]);
            await ejecutarGit(['branch', '-D', tempBranch]);
        } else if (enRama !== tempBranch) {
            try {
                await ejecutarGit(['branch', '-D', tempBranch]);
            } catch (_e2) { /* rama ya eliminada o inaccesible */ }
        } else {
            throw e;
        }
    }

    enRama = (await ejecutarGit(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    if (enRama === 'HEAD') {
        try {
            if (await refGitExiste(refOriginDev)) {
                await ejecutarGit(['checkout', '-B', ramaDev, refOriginDev]);
            } else if (shaAntes) {
                await ejecutarGit(['checkout', '-B', ramaDev, shaAntes]);
            }
        } catch (_e) { /* detached HEAD aceptable */ }
    }
}

async function gitPushArchivosRamaDestino({ rutas, mensaje, ramaDestino }) {
    if (!gitPushPermitido()) {
        throw new Error('Git push no habilitado en este entorno.');
    }
    if (!repoGitDisponible()) {
        throw new Error('El repositorio git no está disponible en este despliegue.');
    }

    const paths = validarRutasEditorPermitidas(rutas);
    if (!paths.length) {
        throw new Error('No hay rutas para subir.');
    }

    const contenidos = new Map();
    for (const rel of paths) {
        const abs = path.resolve(REPO_ROOT, rel);
        const relNorm = path.relative(REPO_ROOT, abs);
        if (relNorm.startsWith('..') || path.isAbsolute(relNorm)) {
            throw new Error(`Ruta no permitida: ${rel}`);
        }
        if (!fs.existsSync(abs)) {
            throw new Error(`No existe el archivo: ${rel}`);
        }
        validarArchivoEditorAntesDeGitPush(rel);
        contenidos.set(rel, fs.readFileSync(abs));
    }

    await configurarIdentidadGit();
    const remoteAuth = construirRemoteAutenticado();
    const shaAntes = (await ejecutarGit(['rev-parse', 'HEAD'])).stdout.trim();
    const branchActual = await obtenerRamaActualGit();
    const tempBranch = `deploy-prod-${Date.now()}`;

    let baseRef = branchActual;
    const remoto = await fetchRamaRemota(ramaDestino);
    if (remoto) {
        try {
            await ejecutarGit(['rev-parse', '--verify', remoto]);
            baseRef = remoto;
        } catch (_e) { /* usar rama actual */ }
    }

    await ejecutarGit(['checkout', '-B', tempBranch, baseRef]);

    for (const [rel, buf] of contenidos) {
        const abs = path.resolve(REPO_ROOT, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, buf);
        await ejecutarGit(['add', '--', rel]);
    }

    const status = await ejecutarGit(['status', '--porcelain', '--', ...paths]);
    if (!status.stdout.trim()) {
        await salirDeRamaTempDeploy({ tempBranch, shaAntes, ramaAntes: branchActual });
        return {
            ok: true,
            sinCambios: true,
            rama: ramaDestino,
            mensaje: `No hay cambios respecto a ${ramaDestino} para los archivos seleccionados.`,
        };
    }

    const commitMsg = String(mensaje || '').trim() || `despliegue: actualizar ${paths.join(', ')}`;
    await ejecutarGit(['commit', '-m', commitMsg]);
    const commitSha = (await ejecutarGit(['rev-parse', 'HEAD'])).stdout.trim();
    await ejecutarGit(['push', remoteAuth, `${tempBranch}:${ramaDestino}`]);
    const resumen = await ejecutarGit(['log', '-1', '--oneline']);

    await salirDeRamaTempDeploy({ tempBranch, shaAntes, ramaAntes: branchActual });

    return {
        ok: true,
        sinCambios: false,
        rama: ramaDestino,
        commit: resumen.stdout.trim(),
        commitSha,
        archivos: paths,
    };
}

async function gitPushProduccion({ rutas, mensaje }) {
    if (!gitPushProduccionPermitido()) {
        throw new Error('Despliegue a producción no habilitado en este entorno.');
    }
    let paths = (rutas || []).map((r) => normalizarRutaEditorRelativa(r)).filter(Boolean);
    if (!paths.length) {
        const pending = await listarArchivosEditorPendientesProduccion();
        paths = pending.archivos;
    }
    paths = validarRutasEditorPermitidas(paths);
    if (!paths.length) {
        throw new Error('No hay archivos de editor pendientes de desplegar a producción.');
    }
    return gitPushArchivosRamaDestino({
        rutas: paths,
        mensaje: mensaje || `despliegue editores: ${paths.join(', ')}`,
        ramaDestino: obtenerRamaGitPushProduccion(),
    });
}

/**
 * Push a dev (si hace falta) y a main en un solo flujo «Actualizar cambios».
 * Omite dev si ya está sincronizado con GitHub.
 */
async function gitPushActualizarCambios({ rutas, mensaje }) {
    if (!gitPushProduccionPermitido()) {
        throw new Error('Actualización de cambios no habilitada en este entorno.');
    }

    const pendDev = await hayCambiosGitPendientesEditores();
    const resultado = {
        ok: true,
        sinCambios: true,
        ramaDev: obtenerRamaGitPush(),
        ramaMain: obtenerRamaGitPushProduccion(),
        dev: null,
        main: null,
        archivos: [],
    };

    if (pendDev.pendiente) {
        resultado.dev = await gitPushEditoresSesion(mensaje);
        if (!resultado.dev.sinCambios) {
            resultado.sinCambios = false;
        }
    } else {
        resultado.dev = {
            ok: true,
            sinCambios: true,
            omitido: true,
            rama: resultado.ramaDev,
            mensaje: 'Dev ya sincronizado con GitHub; no se repitió el push.',
        };
    }

    const pendingMain = await listarArchivosEditorPendientesProduccion();
    let paths = (rutas || []).map((r) => normalizarRutaEditorRelativa(r)).filter(Boolean);
    if (!paths.length) {
        paths = pendingMain.archivos;
    }
    paths = validarRutasEditorPermitidas(paths);

    if (paths.length) {
        resultado.main = await gitPushArchivosRamaDestino({
            rutas: paths,
            mensaje: mensaje || `actualizar cambios: ${paths.join(', ')}`,
            ramaDestino: obtenerRamaGitPushProduccion(),
        });
        if (!resultado.main.sinCambios) {
            resultado.sinCambios = false;
        }
    } else {
        resultado.main = {
            ok: true,
            sinCambios: true,
            omitido: true,
            rama: resultado.ramaMain,
            mensaje: 'Main ya alineado con dev; no se repitió el push.',
        };
    }

    if (resultado.sinCambios) {
        resultado.mensaje = 'No había cambios pendientes en dev ni en main.';
        return resultado;
    }

    resultado.archivos = [...new Set([
        ...(resultado.dev?.archivos || []),
        ...(resultado.main?.archivos || []),
    ])];

    return resultado;
}

async function resumenDespliegueEditor() {
    const prod = await listarArchivosEditorPendientesProduccion();
    let commitsRecientes = [];
    try {
        if (prod.pathsTotales.length) {
            const log = await ejecutarGit(['log', '-8', '--oneline', '--', ...prod.pathsTotales]);
            commitsRecientes = log.stdout.trim().split('\n').filter(Boolean);
        }
    } catch (_e) { /* sin repo o sin commits */ }

    return {
        gitPush: gitPushEstado(),
        produccion: {
            habilitado: gitPushProduccionPermitido(),
            rama: obtenerRamaGitPushProduccion(),
            ramaDev: prod.ramaDev,
            comparacion: prod.comparacion,
            archivosPendientes: prod.archivos,
        },
        pendienteDevGithub: {
            todos: await hayCambiosGitPendientesEditores(),
            archivosModificados: await listarArchivosModificadosEnRutas(rutasRelativasEditorTodas()),
            cartas: await hayCambiosGitPendientesCartas(),
            episodios: await hayCambiosGitPendientesEpisodios(),
            desafios: await hayCambiosGitPendientesDesafios(),
        },
        commitsRecientesEditor: commitsRecientes,
    };
}

function esEntornoDevParaMenuCliente() {
    return esRamaDevRender() || process.env.NODE_ENV !== 'production';
}

function editoresEntornoEstado() {
    return {
        esDev: esEntornoDevParaMenuCliente(),
        mostrarMenuDevTools: esEntornoDevParaMenuCliente(),
        editoresHabilitados: editoresInternosPermitidos(),
        rama: String(process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || '').trim() || null,
        ramaDevRender: esRamaDevRender(),
    };
}

async function hayCommitsSinPush(branch) {
    try {
        const unpushed = await ejecutarGit(['rev-list', '--count', `origin/${branch}..HEAD`]);
        return parseInt(String(unpushed.stdout || '').trim(), 10) > 0;
    } catch (_e) {
        try {
            const unpushed = await ejecutarGit(['rev-list', '--count', '@{u}..HEAD']);
            return parseInt(String(unpushed.stdout || '').trim(), 10) > 0;
        } catch (_e2) {
            return false;
        }
    }
}

async function hayCambiosGitPendientesEnRutas(rutas) {
    if (!repoGitDisponible()) {
        return { pendiente: false, motivo: 'sin_repo' };
    }
    const paths = (rutas || []).map((p) => String(p || '').trim()).filter(Boolean);
    if (!paths.length) {
        return { pendiente: false, motivo: 'sin_rutas' };
    }
    const gitPaths = paths.map((p) => p.replace(/\\/g, '/'));
    const status = await ejecutarGit(['status', '--porcelain', '--', ...gitPaths]);
    if (status.stdout.trim()) {
        return { pendiente: true, motivo: 'sin_commit' };
    }
    const branch = obtenerRamaGitPush();
    const sinPush = await hayCommitsSinPush(branch);
    if (sinPush) {
        return { pendiente: true, motivo: 'sin_push' };
    }
    return { pendiente: false, motivo: null };
}

async function hayCambiosGitPendientesEpisodios() {
    return hayCambiosGitPendientesEnRutas(rutasRelativasEpisodiosJson());
}

async function hayCambiosGitPendientesCartas() {
    return hayCambiosGitPendientesEnRutas(rutasRelativasCartas());
}

async function hayCambiosGitPendientesDesafios() {
    return hayCambiosGitPendientesEnRutas(rutasRelativasDesafios());
}

async function hayCambiosGitPendientesEditores() {
    return hayCambiosGitPendientesEnRutas(rutasRelativasEditorTodas());
}

async function listarArchivosModificadosEnRutas(rutas) {
    const paths = (rutas || []).map((p) => normalizarRutaEditorRelativa(p)).filter(Boolean);
    if (!repoGitDisponible() || !paths.length) {
        return [];
    }
    const status = await ejecutarGit(['status', '--porcelain', '--', ...paths]);
    const archivos = new Set();
    status.stdout.split('\n').forEach((line) => {
        const p = line.slice(3).trim().replace(/\\/g, '/');
        if (p && paths.includes(p)) {
            archivos.add(p);
        }
    });
    return [...archivos].sort();
}

async function gitPushEditoresSesion(mensaje) {
    return gitPushArchivos({
        rutas: rutasRelativasEditorTodas(),
        mensaje: mensaje || 'editor: actualizar datos de editores internos',
    });
}

module.exports = {
    esRamaDevRender,
    editoresInternosPermitidos,
    episodiosEditorPermitido,
    cartasEditorPermitido,
    gitPushPermitido,
    gitPushEstado,
    editoresEntornoEstado,
    verificarGitPushAuth,
    gitPushEpisodios,
    gitPushCartas,
    gitPushDesafios,
    hayCambiosGitPendientesEpisodios,
    hayCambiosGitPendientesCartas,
    hayCambiosGitPendientesDesafios,
    hayCambiosGitPendientesEditores,
    listarArchivosModificadosEnRutas,
    gitPushEditoresSesion,
    rutasRelativasEditorTodas,
    esRutaEditorPermitida,
    gitPushProduccionPermitido,
    obtenerRamaGitPushProduccion,
    listarArchivosEditorPendientesProduccion,
    gitPushProduccion,
    gitPushActualizarCambios,
    resumenDespliegueEditor,
};
