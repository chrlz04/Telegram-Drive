import { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize, FileText } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import mammoth from 'mammoth';
import { TelegramFile } from '../../types';

interface StreamInfo {
    token: string;
    base_url: string;
}

interface DocxViewerProps {
    file: TelegramFile;
    onClose: () => void;
    onNext?: () => void;
    onPrev?: () => void;
    currentIndex?: number;
    totalItems?: number;
    activeFolderId: number | null;
}

// ---------------------------------------------------------------------------
// Document CSS — scoped to .docx-body to avoid polluting the rest of the app
// ---------------------------------------------------------------------------
const DOCX_STYLES = `
.docx-body {
    font-family: Calibri, 'Segoe UI', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.65;
    color: #111827;
    word-break: break-word;
}
.docx-body h1 { font-size: 26px; font-weight: 700; margin: 20px 0 10px; color: #111827; }
.docx-body h2 { font-size: 21px; font-weight: 600; margin: 16px 0 8px;  color: #1f2937; }
.docx-body h3 { font-size: 17px; font-weight: 600; margin: 14px 0 6px;  color: #1f2937; }
.docx-body h4 { font-size: 15px; font-weight: 600; margin: 12px 0 4px; }
.docx-body p  { margin: 6px 0; }
.docx-body ul, .docx-body ol { margin: 8px 0; padding-left: 28px; }
.docx-body li { margin: 4px 0; }
.docx-body table {
    border-collapse: collapse;
    width: 100%;
    margin: 14px 0;
    font-size: 13px;
}
.docx-body th, .docx-body td {
    border: 1px solid #d1d5db;
    padding: 7px 12px;
    text-align: left;
    vertical-align: top;
}
.docx-body th { background: #f3f4f6; font-weight: 600; }
.docx-body tr:nth-child(even) td { background: #f9fafb; }
.docx-body strong, .docx-body b { font-weight: 700; }
.docx-body em,     .docx-body i { font-style: italic; }
.docx-body u { text-decoration: underline; }
.docx-body s, .docx-body del { text-decoration: line-through; color: #9ca3af; }
.docx-body a { color: #2563eb; text-decoration: underline; }
.docx-body a:hover { color: #1d4ed8; }
.docx-body img { max-width: 100%; height: auto; margin: 8px 0; border-radius: 4px; }
.docx-body blockquote {
    margin: 10px 0 10px 8px;
    padding: 8px 16px;
    border-left: 4px solid #d1d5db;
    color: #6b7280;
    background: #f9fafb;
    border-radius: 0 6px 6px 0;
}
.docx-body hr {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 20px 0;
}
.docx-body code, .docx-body pre {
    font-family: 'Cascadia Code', Consolas, monospace;
    background: #f3f4f6;
    border-radius: 4px;
    font-size: 12.5px;
}
.docx-body code { padding: 1px 5px; }
.docx-body pre  { padding: 12px 16px; overflow-x: auto; margin: 10px 0; }
`;

export function DocxViewer({
    file, onClose, onNext, onPrev, currentIndex, totalItems, activeFolderId,
}: DocxViewerProps) {
    const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
    const [html, setHtml] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [scale, setScale] = useState(1);

    // Fetch stream credentials once
    useEffect(() => {
        invoke<StreamInfo>('cmd_get_stream_info')
            .then(setStreamInfo)
            .catch(() => setError('Failed to initialize stream'));
    }, []);

    // Load and convert DOCX when stream info or file changes
    useEffect(() => {
        if (!streamInfo) return;

        let cancelled = false;
        setLoading(true);
        setError(null);
        setHtml(null);

        const folderParam = activeFolderId !== null ? activeFolderId.toString() : 'home';
        const url = `${streamInfo.base_url}/stream/${folderParam}/${file.id}?token=${streamInfo.token}`;

        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.arrayBuffer();
            })
            .then(buffer => mammoth.convertToHtml({ arrayBuffer: buffer }))
            .then(result => {
                if (cancelled) return;
                setHtml(result.value || '<p><em>Document appears to be empty.</em></p>');
                setLoading(false);
            })
            .catch(err => {
                if (cancelled) return;
                console.error('DocxViewer:', err);
                setError('Failed to load document. The file may be corrupted or in an unsupported format.');
                setLoading(false);
            });

        return () => { cancelled = true; };
    }, [streamInfo, file.id, activeFolderId]);

    // Keyboard shortcuts — mirrors PdfViewer
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
            const k = e.key.toLowerCase();
            if (e.key === 'ArrowRight' || k === 'l') { e.preventDefault(); onNext?.(); }
            if (e.key === 'ArrowLeft'  || k === 'j') { e.preventDefault(); onPrev?.(); }
            if (e.key === 'Escape')                   { e.preventDefault(); onClose(); }
            if (e.key === '=' || k === '+') { e.preventDefault(); setScale(s => Math.min(+(s + 0.1).toFixed(1), 2.5)); }
            if (e.key === '-')              { e.preventDefault(); setScale(s => Math.max(+(s - 0.1).toFixed(1), 0.4)); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, onNext, onPrev]);

    const zoomIn  = (e: React.MouseEvent) => { e.stopPropagation(); setScale(s => Math.min(+(s + 0.1).toFixed(1), 2.5)); };
    const zoomOut = (e: React.MouseEvent) => { e.stopPropagation(); setScale(s => Math.max(+(s - 0.1).toFixed(1), 0.4)); };
    const fitPage = (e: React.MouseEvent) => { e.stopPropagation(); setScale(1); };

    return (
        <div
            className="fixed inset-0 z-[200] bg-black/90 flex flex-col backdrop-blur-md animate-in fade-in duration-200"
            onClick={onClose}
        >
            {/* Inject scoped document styles */}
            <style>{DOCX_STYLES}</style>

            {/* ── Top toolbar ─────────────────────────────────── */}
            <div className="absolute top-4 left-0 right-0 flex justify-between items-center px-8 z-10 pointer-events-none">
                {/* File name badge */}
                <div className="flex items-center gap-2 text-white bg-black/40 backdrop-blur-md px-4 py-2 rounded-full pointer-events-auto border border-white/10">
                    <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <h3 className="text-sm font-medium truncate max-w-xs">{file.name}</h3>
                </div>

                {/* Zoom controls */}
                <div className="flex items-center gap-1 pointer-events-auto bg-black/40 backdrop-blur-md p-1.5 rounded-full border border-white/10">
                    <button onClick={zoomOut} title="Zoom Out (-)" className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors">
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-white/90 font-mono min-w-[3.5rem] text-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <button onClick={zoomIn} title="Zoom In (+)" className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors">
                        <ZoomIn className="w-4 h-4" />
                    </button>
                    <div className="w-px h-4 bg-white/20 mx-1" />
                    <button onClick={fitPage} title="Reset Zoom" className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors">
                        <Maximize className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* ── Prev / Next navigation ───────────────────────── */}
            <button
                onClick={e => { e.stopPropagation(); onPrev?.(); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/50 hover:text-white bg-black/40 backdrop-blur-md hover:bg-black/60 rounded-full transition-all z-10 border border-white/10"
                title="Previous file (← / J)"
            >
                <ChevronLeft className="w-6 h-6" />
            </button>
            <button
                onClick={e => { e.stopPropagation(); onNext?.(); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/50 hover:text-white bg-black/40 backdrop-blur-md hover:bg-black/60 rounded-full transition-all z-10 border border-white/10"
                title="Next file (→ / L)"
            >
                <ChevronRight className="w-6 h-6" />
            </button>

            {/* ── Close ───────────────────────────────────────── */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 p-3 text-white/50 hover:text-white bg-black/40 backdrop-blur-md hover:bg-black/60 rounded-full transition-all z-10 border border-white/10"
                title="Close (Esc)"
            >
                <X className="w-6 h-6" />
            </button>

            {/* ── Scrollable document area ─────────────────────── */}
            <div
                className="flex-1 w-full overflow-auto custom-scrollbar flex flex-col items-center pt-20 pb-8 gap-4"
                onClick={e => e.stopPropagation()}
            >
                {/* Loading */}
                {loading && (
                    <div className="flex flex-col items-center justify-center flex-1 text-white gap-4">
                        <div className="w-10 h-10 border-4 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                        <p className="text-sm text-white/70">Loading document…</p>
                        <p className="text-xs text-white/40">Downloading from Telegram</p>
                    </div>
                )}

                {/* Error */}
                {error && !loading && (
                    <div className="flex flex-col items-center justify-center text-white bg-red-500/20 p-6 rounded-xl border border-red-500/50 max-w-md mt-20 text-center gap-2">
                        <FileText className="w-8 h-8 text-red-400" />
                        <p className="font-semibold">Could not load document</p>
                        <p className="text-sm text-white/70">{error}</p>
                    </div>
                )}

                {/* Document page */}
                {html && !loading && (
                    <div
                        className="bg-white rounded-xl shadow-2xl border border-white/10"
                        style={{
                            width: '794px',          /* A4 at 96 dpi */
                            minHeight: '1123px',
                            padding: '72px 80px',
                            zoom: scale,
                            transformOrigin: 'top center',
                        }}
                    >
                        <div
                            className="docx-body"
                            dangerouslySetInnerHTML={{ __html: html }}
                        />
                    </div>
                )}
            </div>

            {/* ── Position counter ─────────────────────────────── */}
            {currentIndex !== undefined && totalItems !== undefined && totalItems > 1 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-xs bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 pointer-events-none">
                    {currentIndex + 1} / {totalItems}
                </div>
            )}
        </div>
    );
}
