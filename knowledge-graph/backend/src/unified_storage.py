"""Shared schema for processed source data stored in the single master SQLite DB."""

from __future__ import annotations

import sqlite3


UNIFIED_SOURCE_SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS unified_database_migrations (
    migration_id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL,
    source_summary_json TEXT NOT NULL DEFAULT '{}',
    result_summary_json TEXT NOT NULL DEFAULT '{}',
    verification_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS processed_source_datasets (
    dataset_id TEXT PRIMARY KEY,
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,
    source_file_name TEXT NOT NULL DEFAULT '',
    source_sha256 TEXT NOT NULL DEFAULT '',
    source_schema_json TEXT NOT NULL DEFAULT '{}',
    record_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS processed_source_records (
    dataset_id TEXT NOT NULL,
    source_row_key TEXT NOT NULL,
    record_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    PRIMARY KEY(dataset_id, source_row_key),
    FOREIGN KEY(dataset_id) REFERENCES processed_source_datasets(dataset_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_processed_source_records_hash
    ON processed_source_records(content_hash);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    parent_folder TEXT,
    sha256 TEXT NOT NULL,
    company_name TEXT NOT NULL,
    report_time TEXT,
    page_count INTEGER,
    full_text TEXT,
    parsed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company_profiles (
    document_id INTEGER PRIMARY KEY,
    company_name TEXT,
    former_name TEXT,
    legal_representative TEXT,
    unified_social_credit_code TEXT,
    organization_code TEXT,
    registration_no TEXT,
    company_nature TEXT,
    registration_status TEXT,
    company_type TEXT,
    registered_capital TEXT,
    paid_in_capital TEXT,
    establishment_date TEXT,
    approval_date TEXT,
    staff_size TEXT,
    enterprise_size TEXT,
    region TEXT,
    national_industry TEXT,
    strategic_emerging_industry TEXT,
    business_scope TEXT,
    registered_address TEXT,
    communication_address TEXT,
    source_status TEXT NOT NULL DEFAULT '已抽取',
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS company_statistics (
    document_id INTEGER PRIMARY KEY,
    company_name TEXT,
    patent_application_count INTEGER,
    legal_case_count INTEGER,
    negative_news_count INTEGER,
    non_negative_news_count INTEGER,
    unknown_news_count INTEGER,
    total_news_count INTEGER,
    negative_news_ratio REAL,
    non_negative_news_ratio REAL,
    shareholder_count INTEGER,
    top_shareholder TEXT,
    top_shareholding_ratio REAL,
    shareholder_amount_summary TEXT,
    external_investment_count INTEGER,
    external_investment_summary TEXT,
    missing_summary TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    customer_name TEXT,
    sales_ratio TEXT,
    sales_amount_10k TEXT,
    report_period_or_date TEXT,
    data_source TEXT,
    raw_text TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS financing_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    event_date TEXT,
    event_name TEXT,
    round_name TEXT,
    financing_amount TEXT,
    valuation TEXT,
    investors TEXT,
    raw_text TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS missing_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    module TEXT NOT NULL,
    field_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '数据缺失',
    reason TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS news_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    title TEXT,
    publish_date TEXT,
    importance TEXT,
    sentiment TEXT,
    risk_category TEXT,
    raw_text TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    patent_name TEXT,
    publication_no TEXT,
    patent_type TEXT,
    inventors TEXT,
    agency TEXT,
    abstract TEXT,
    legal_status TEXT,
    publication_date TEXT,
    raw_text TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    name TEXT,
    role TEXT,
    gender TEXT,
    education TEXT,
    birth_year TEXT,
    raw_text TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raw_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    page_no INTEGER,
    table_index INTEGER,
    extraction_mode TEXT,
    row_count INTEGER,
    column_count INTEGER,
    table_json TEXT,
    table_text TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS risk_raw_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    risk_type TEXT,
    section_title TEXT,
    content TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    section_no TEXT,
    title TEXT,
    page_start INTEGER,
    page_end INTEGER,
    content TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shareholders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    shareholder_name TEXT,
    shareholding_ratio TEXT,
    subscribed_amount TEXT,
    share_type TEXT,
    shareholder_type TEXT,
    raw_text TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS software_copyrights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    approval_date TEXT,
    software_full_name TEXT,
    software_short_name TEXT,
    registration_no TEXT,
    category_no TEXT,
    version_no TEXT,
    raw_text TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    supplier_name TEXT,
    purchase_ratio TEXT,
    purchase_amount_10k TEXT,
    report_period_or_date TEXT,
    data_source TEXT,
    raw_text TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    tender_type TEXT,
    project_name TEXT,
    publish_date TEXT,
    region TEXT,
    counterparty TEXT,
    amount_10k TEXT,
    raw_text TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trademarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    trademark_name TEXT,
    registration_no TEXT,
    status TEXT,
    category TEXT,
    application_date TEXT,
    raw_text TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pdf_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL DEFAULT '',
    source_kind TEXT NOT NULL,
    source TEXT NOT NULL,
    file_name TEXT NOT NULL,
    local_path TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL UNIQUE,
    file_size INTEGER NOT NULL,
    report_type TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL DEFAULT '',
    downloaded_at TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pdf_documents_company ON pdf_documents(company_name);
CREATE INDEX IF NOT EXISTS idx_pdf_documents_report_type ON pdf_documents(report_type);
"""


def ensure_unified_storage_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(UNIFIED_SOURCE_SCHEMA)
    conn.commit()
