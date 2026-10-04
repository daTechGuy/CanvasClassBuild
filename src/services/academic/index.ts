export { searchPapers, getPaperByDoi } from './semanticScholar';
export type { SsPaper } from './semanticScholar';
export { fetchCrossrefWork, normalizeDoi } from './crossref';
export type { CrossrefWork } from './crossref';
export { findOpenAccess } from './unpaywall';
export type { UnpaywallHit } from './unpaywall';
export { enrichDossier, titlesMatch, normalizeTitle } from './enrich';
export type { EnrichmentStats, EnrichOptions } from './enrich';
