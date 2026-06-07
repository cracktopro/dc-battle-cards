/**
 * Escritura segura de catálogos Excel (editores internos).
 * - Backup automático antes de sobrescribir
 * - Escritura atómica (tmp → destino)
 * - Bloqueo de truncamientos masivos del catálogo
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const MAX_BACKUPS = 25;
const DEFAULT_MIN_RATIO = Number(process.env.EDITOR_XLSX_MIN_RATIO || '0.85');

const PERFILES = {
    cartas: {
        etiqueta: 'cartas',
        campoClave: 'Nombre',
        minFilasAbsoluto: Number(process.env.CARTAS_EDITOR_MIN_FILAS || '40'),
        minRatio: DEFAULT_MIN_RATIO,
    },
    desafios: {
        etiqueta: 'desafios',
        campoClave: 'nombre',
        minFilasAbsoluto: Number(process.env.DESAFIOS_EDITOR_MIN_FILAS || '3'),
        minRatio: DEFAULT_MIN_RATIO,
    },
    asaltos: {
        etiqueta: 'asaltos',
        campoClave: 'nombre',
        minFilasAbsoluto: Number(process.env.ASALTOS_EDITOR_MIN_FILAS || '1'),
        minRatio: DEFAULT_MIN_RATIO,
    },
    eventos: {
        etiqueta: 'eventos',
        campoClave: 'nombre',
        minFilasAbsoluto: Number(process.env.EVENTOS_EDITOR_MIN_FILAS || '1'),
        minRatio: DEFAULT_MIN_RATIO,
    },
    eventos_online: {
        etiqueta: 'eventos-online',
        campoClave: 'nombre',
        minFilasAbsoluto: Number(process.env.EVENTOS_ONLINE_EDITOR_MIN_FILAS || '1'),
        minRatio: DEFAULT_MIN_RATIO,
    },
    skins: {
        etiqueta: 'skins',
        campoClave: 'Nombre',
        minFilasAbsoluto: Number(process.env.SKINS_EDITOR_MIN_FILAS || '1'),
        minRatio: DEFAULT_MIN_RATIO,
    },
};

function contarFilasConCampo(filas, campoClave) {
    if (!Array.isArray(filas)) {
        return 0;
    }
    if (!campoClave) {
        return filas.length;
    }
    return filas.filter((f) => String(f?.[campoClave] ?? '').trim() !== '').length;
}

function contarFilasEnArchivoXlsx(rutaAbsoluta, campoClave) {
    if (!rutaAbsoluta || !fs.existsSync(rutaAbsoluta)) {
        return 0;
    }
    const workbook = XLSX.readFile(rutaAbsoluta);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        return 0;
    }
    const filas = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    return contarFilasConCampo(filas, campoClave);
}

function podarBackups(dir, etiqueta, max) {
    let entries = [];
    try {
        entries = fs.readdirSync(dir)
            .filter((f) => f.startsWith(`${etiqueta}-`))
            .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.t - a.t);
    } catch (_e) {
        return;
    }
    entries.slice(max).forEach(({ f }) => {
        try {
            fs.unlinkSync(path.join(dir, f));
        } catch (_err) {
            /* ignore */
        }
    });
}

function crearBackupArchivo(rutaAbsoluta, etiqueta) {
    if (!rutaAbsoluta || !fs.existsSync(rutaAbsoluta)) {
        return null;
    }
    const dir = path.join(path.dirname(rutaAbsoluta), '.backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = path.extname(rutaAbsoluta) || '.xlsx';
    const dest = path.join(dir, `${etiqueta}-${stamp}${ext}`);
    fs.copyFileSync(rutaAbsoluta, dest);
    podarBackups(dir, etiqueta, MAX_BACKUPS);
    return dest;
}

function validarIntegridadEscritura({
    rutaAbsoluta,
    filasNuevas,
    campoClave,
    minFilasAbsoluto,
    minRatio,
    confirmarTruncamiento,
    etiquetaArchivo,
}) {
    const nuevas = contarFilasConCampo(filasNuevas, campoClave);
    const existentes = contarFilasEnArchivoXlsx(rutaAbsoluta, campoClave);
    const ratioMin = Number.isFinite(minRatio) && minRatio > 0 && minRatio <= 1 ? minRatio : DEFAULT_MIN_RATIO;
    const minAbs = Number.isFinite(minFilasAbsoluto) && minFilasAbsoluto >= 0 ? minFilasAbsoluto : 0;
    const umbralRatio = existentes > 0 ? Math.ceil(existentes * ratioMin) : 0;
    const nombreArchivo = etiquetaArchivo || path.basename(rutaAbsoluta || 'catalogo');

    if (confirmarTruncamiento) {
        if (existentes > 0 && nuevas < existentes) {
            console.warn(`[editor-xlsx] Truncamiento confirmado en ${nombreArchivo}: ${existentes} → ${nuevas} filas`);
        }
        return { ok: true, existentes, nuevas, advertencia: existentes > nuevas };
    }

    if (minAbs > 0 && existentes >= minAbs && nuevas < minAbs) {
        return {
            ok: false,
            codigo: 'TRUNCAMIENTO_CATALOGO',
            error: `No se guardó ${nombreArchivo}: pasaría de ${existentes} a ${nuevas} filas (mínimo seguro: ${minAbs}). Si es intencional, confirma el guardado en el editor.`,
            existentes,
            nuevas,
            minFilasAbsoluto: minAbs,
        };
    }

    if (existentes > 0 && nuevas < umbralRatio) {
        return {
            ok: false,
            codigo: 'TRUNCAMIENTO_CATALOGO',
            error: `No se guardó ${nombreArchivo}: pasaría de ${existentes} a ${nuevas} filas (pérdida > ${Math.round((1 - ratioMin) * 100)}%). Revisa el catálogo cargado o confirma explícitamente si borraste filas a propósito.`,
            existentes,
            nuevas,
            umbralRatio,
        };
    }

    return { ok: true, existentes, nuevas };
}

function escribirArchivoAtomico(rutaAbsoluta, writeFn) {
    const dir = path.dirname(rutaAbsoluta);
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(rutaAbsoluta) || '.xlsx';
    const base = path.basename(rutaAbsoluta, ext);
    const tmp = path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}${ext}`);
    try {
        writeFn(tmp);
        if (!fs.existsSync(tmp)) {
            throw new Error('No se generó el archivo temporal.');
        }
        fs.copyFileSync(tmp, rutaAbsoluta);
    } finally {
        if (fs.existsSync(tmp)) {
            try {
                fs.unlinkSync(tmp);
            } catch (_e) {
                /* ignore */
            }
        }
    }
}

function escribirWorkbookXlsx(rutaDestino, filas, columnas, sheetName) {
    const cols = columnas && columnas.length ? columnas : undefined;
    const sheet = XLSX.utils.json_to_sheet(filas, cols ? { header: cols } : undefined);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName || 'Hoja1');
    XLSX.writeFile(workbook, rutaDestino);
}

/**
 * Escribe un .xlsx con backup, validación anti-truncamiento y verificación post-escritura.
 */
function escribirXlsxProtegido(perfilKey, rutaAbsoluta, filas, columnas, sheetName, opciones = {}) {
    const perfil = PERFILES[perfilKey] || {
        etiqueta: perfilKey,
        campoClave: '',
        minFilasAbsoluto: 1,
        minRatio: DEFAULT_MIN_RATIO,
    };
    const val = validarIntegridadEscritura({
        rutaAbsoluta,
        filasNuevas: filas,
        campoClave: perfil.campoClave,
        minFilasAbsoluto: perfil.minFilasAbsoluto,
        minRatio: perfil.minRatio,
        confirmarTruncamiento: Boolean(opciones.confirmarTruncamiento),
        etiquetaArchivo: path.basename(rutaAbsoluta),
    });
    if (!val.ok) {
        const err = new Error(val.error);
        err.codigo = val.codigo;
        err.detalles = val;
        throw err;
    }

    crearBackupArchivo(rutaAbsoluta, perfil.etiqueta);

    escribirArchivoAtomico(rutaAbsoluta, (tmpPath) => {
        escribirWorkbookXlsx(tmpPath, filas, columnas, sheetName);
    });

    const leidas = contarFilasEnArchivoXlsx(rutaAbsoluta, perfil.campoClave);
    const esperadas = contarFilasConCampo(filas, perfil.campoClave);
    if (leidas !== esperadas) {
        throw new Error(`Verificación post-guardado fallida en ${path.basename(rutaAbsoluta)}: se esperaban ${esperadas} filas y se leyeron ${leidas}.`);
    }

    return {
        total: esperadas,
        advertencia: Boolean(val.advertencia),
        existentes: val.existentes,
    };
}

function crearBackupTexto(rutaAbsoluta, etiqueta) {
    return crearBackupArchivo(rutaAbsoluta, etiqueta);
}

function escribirTextoProtegido(rutaAbsoluta, contenido, opciones = {}) {
    const etiqueta = opciones.etiqueta || path.basename(rutaAbsoluta, path.extname(rutaAbsoluta));
    const minBytes = Number(opciones.minBytes || 0);
    const ratioMin = Number.isFinite(opciones.minRatio) ? opciones.minRatio : DEFAULT_MIN_RATIO;
    const confirmar = Boolean(opciones.confirmarTruncamiento);

    let existentesBytes = 0;
    if (fs.existsSync(rutaAbsoluta)) {
        existentesBytes = fs.statSync(rutaAbsoluta).size;
    }
    const nuevosBytes = Buffer.byteLength(String(contenido || ''), 'utf8');

    if (!confirmar && existentesBytes > 0) {
        const umbral = Math.max(minBytes, Math.floor(existentesBytes * ratioMin));
        if (nuevosBytes < umbral) {
            const err = new Error(`No se guardó ${path.basename(rutaAbsoluta)}: el archivo nuevo es demasiado pequeño (${nuevosBytes} B vs ${existentesBytes} B actuales).`);
            err.codigo = 'TRUNCAMIENTO_CATALOGO';
            err.detalles = { existentesBytes, nuevosBytes, umbral };
            throw err;
        }
    }

    crearBackupTexto(rutaAbsoluta, etiqueta);
    escribirArchivoAtomico(rutaAbsoluta, (tmpPath) => {
        fs.writeFileSync(tmpPath, contenido, 'utf8');
    });
}

function validarPerfilAntesDeGitPush(perfilKey, rutaAbsoluta) {
    const perfil = PERFILES[perfilKey];
    if (!perfil || !rutaAbsoluta || !fs.existsSync(rutaAbsoluta)) {
        return;
    }
    const total = contarFilasEnArchivoXlsx(rutaAbsoluta, perfil.campoClave);
    if (total < perfil.minFilasAbsoluto) {
        throw new Error(
            `Git push bloqueado: ${path.basename(rutaAbsoluta)} tiene solo ${total} filas (mínimo ${perfil.minFilasAbsoluto}). Restaura un backup o el historial git antes de subir.`
        );
    }
}

module.exports = {
    PERFILES,
    contarFilasConCampo,
    contarFilasEnArchivoXlsx,
    validarIntegridadEscritura,
    escribirXlsxProtegido,
    escribirTextoProtegido,
    validarPerfilAntesDeGitPush,
    crearBackupArchivo,
};
