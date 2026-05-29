/**
 * Normalización de episodios con capítulos (JSON) y compatibilidad con timeline en raíz.
 */
(function (root) {
    function normalizarCapitulos(episodioData) {
        const data = episodioData && typeof episodioData === 'object' ? episodioData : {};
        if (Array.isArray(data.capitulos) && data.capitulos.length > 0) {
            return data.capitulos.map((cap, idx) => ({
                capitulo_id: String(cap.capitulo_id || cap.id || `cap_${String(idx + 1).padStart(2, '0')}`),
                nombre: String(cap.nombre || `Capítulo ${idx + 1}`).trim(),
                descripcion: String(cap.descripcion || cap.descripcion_corta || '').trim(),
                timeline: Array.isArray(cap.timeline) ? cap.timeline : [],
            }));
        }
        const timelineLegacy = Array.isArray(data.timeline) ? data.timeline : [];
        return [{
            capitulo_id: 'cap_01',
            nombre: String(data.nombre || 'Capítulo 1').trim() || 'Capítulo 1',
            descripcion: '',
            timeline: timelineLegacy,
        }];
    }

    function indiceCapituloPorId(capitulos, capituloId) {
        const id = String(capituloId || '').trim();
        if (!id) return -1;
        return (Array.isArray(capitulos) ? capitulos : []).findIndex((c) => c.capitulo_id === id);
    }

    root.DCEpisodiosCapitulos = {
        normalizarCapitulos,
        indiceCapituloPorId,
    };
}(typeof window !== 'undefined' ? window : globalThis));
