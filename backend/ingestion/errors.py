"""Erreurs métier du pipeline d'ingestion."""


class IngestionError(Exception):
    """Échec contrôlé d'extraction, d'indexation ou de suppression."""
