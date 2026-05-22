import { useState, useRef, useEffect } from 'react';
import { HardDrive, Folder, Plus, RefreshCw, LogOut, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { TelegramFolder, BandwidthStats } from '../../types';
import { formatBytes } from '../../utils';

// ---------------------------------------------------------------------------
// Tree helpers (mirrored from Sidebar)
// ---------------------------------------------------------------------------

interface FolderNode extends TelegramFolder {
    children: FolderNode[];
}

function buildTree(folders: TelegramFolder[]): FolderNode[] {
    const map = new Map<number, FolderNode>();
    for (const f of folders) map.set(f.id, { ...f, children: [] });
    const roots: FolderNode[] = [];
    for (const node of map.values()) {
        const pid = node.parent_id;
        if (pid != null && map.has(pid)) map.get(pid)!.children.push(node);
        else roots.push(node);
    }
    return roots;
}

// ---------------------------------------------------------------------------
// Recursive folder tree item for the dropdown panel
// ---------------------------------------------------------------------------

function FolderTreeItem({ node, depth, activeFolderId, setActiveFolderId, onClose, onDelete, onRename }: {
    node: FolderNode;
    depth: number;
    activeFolderId: number | null;
    setActiveFolderId: (id: number | null) => void;
    onClose: () => void;
    onDelete?: (id: number, name: string) => void;
    onRename?: (id: number, newName: string, parentId: number | null) => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
    const ctxRef = useRef<HTMLDivElement>(null);
    const isActive = activeFolderId === node.id;

    useEffect(() => {
        if (!ctxMenu) return;
        const handleMouseDown = (e: MouseEvent) => {
            if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
        };
        const handleContextMenu = (e: MouseEvent) => {
            if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
        };
        const handleResize = () => setCtxMenu(null);
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('contextmenu', handleContextMenu);
        window.addEventListener('resize', handleResize);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('contextmenu', handleContextMenu);
            window.removeEventListener('resize', handleResize);
        };
    }, [ctxMenu]);

    const submitRename = () => {
        const trimmed = renameValue.trim();
        if (trimmed && trimmed !== node.name && onRename) {
            onRename(node.id, trimmed, node.parent_id);
        }
        setRenaming(false);
        setRenameValue('');
    };

    return (
        <div>
            <div
                className="group relative"
                onContextMenu={(e) => {
                    if (onDelete || onRename) {
                        e.preventDefault();
                        e.stopPropagation();
                        setCtxMenu({ x: e.clientX, y: e.clientY });
                    }
                }}
            >
                {renaming ? (
                    <div style={{ paddingLeft: `${12 + depth * 16}px` }} className="pr-2 py-1">
                        <input
                            autoFocus
                            className="w-full bg-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-telegram-primary"
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') submitRename();
                                if (e.key === 'Escape') { setRenaming(false); setRenameValue(''); }
                            }}
                            onBlur={() => { setRenaming(false); setRenameValue(''); }}
                        />
                    </div>
                ) : (
                    <button
                        onClick={() => { setActiveFolderId(node.id); onClose(); }}
                        style={{ paddingLeft: `${12 + depth * 16}px` }}
                        className={`w-full flex items-center gap-2 py-1.5 pr-2 text-sm rounded-md transition-colors ${isActive ? 'bg-telegram-primary/20 text-telegram-primary' : 'text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text'}`}
                    >
                        {node.children.length > 0 ? (
                            <ChevronRight
                                className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                                onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
                            />
                        ) : (
                            <span className="w-3.5 flex-shrink-0" />
                        )}
                        <Folder className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="flex-1 truncate text-left">{node.name}</span>

                        {/* Hover action buttons */}
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0">
                            {onRename && (
                                <div
                                    onClick={e => { e.stopPropagation(); setRenameValue(node.name); setRenaming(true); }}
                                    className="p-0.5 hover:text-telegram-primary rounded"
                                    title="Rename"
                                >
                                    <Pencil className="w-3 h-3" />
                                </div>
                            )}
                            {onDelete && (
                                <div
                                    onClick={e => { e.stopPropagation(); onDelete(node.id, node.name); }}
                                    className="p-0.5 hover:text-red-400 rounded"
                                    title="Delete"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </div>
                            )}
                        </div>
                    </button>
                )}
            </div>

            {/* Context menu */}
            {ctxMenu && (
                <div
                    ref={ctxRef}
                    className="fixed z-[60] min-w-[150px] bg-telegram-surface/95 backdrop-blur-xl border border-telegram-border rounded-lg shadow-2xl p-1.5 flex flex-col gap-0.5"
                    style={{ left: ctxMenu.x, top: ctxMenu.y }}
                    onClick={e => e.stopPropagation()}
                    onContextMenu={e => e.preventDefault()}
                >
                    {onRename && (
                        <button
                            onClick={() => { setRenameValue(node.name); setRenaming(true); setCtxMenu(null); }}
                            className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full"
                        >
                            <Pencil className="w-4 h-4 text-telegram-primary" />
                            Rename
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={() => { onDelete(node.id, node.name); setCtxMenu(null); }}
                            className="flex items-center gap-2 px-2 py-1.5 text-sm text-red-500 hover:bg-red-500/10 rounded transition-colors text-left w-full"
                        >
                            <Trash2 className="w-4 h-4" />
                            Delete
                        </button>
                    )}
                </div>
            )}

            {expanded && node.children.map(child => (
                <FolderTreeItem
                    key={child.id}
                    node={child}
                    depth={depth + 1}
                    activeFolderId={activeFolderId}
                    setActiveFolderId={setActiveFolderId}
                    onClose={onClose}
                    onDelete={onDelete}
                    onRename={onRename}
                />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Pill button helper
// ---------------------------------------------------------------------------

function PillButton({ children, onClick, title, active, disabled, danger, btnRef }: {
    children: React.ReactNode;
    onClick: () => void;
    title: string;
    active?: boolean;
    disabled?: boolean;
    danger?: boolean;
    btnRef?: React.RefObject<HTMLButtonElement | null>;
}) {
    const baseClass = 'p-2 rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed';
    const colorClass = danger
        ? 'text-telegram-subtext hover:text-red-400 hover:bg-red-500/15 hover:shadow-[0_0_12px_rgba(239,68,68,0.35)]'
        : active
            ? 'bg-telegram-primary/20 text-telegram-primary'
            : 'text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text';

    return (
        <button
            ref={btnRef}
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={`${baseClass} ${colorClass}`}
        >
            {children}
        </button>
    );
}

// ---------------------------------------------------------------------------
// FloatingPillNav
// ---------------------------------------------------------------------------

export interface FloatingPillNavProps {
    folders: TelegramFolder[];
    activeFolderId: number | null;
    setActiveFolderId: (id: number | null) => void;
    isConnected: boolean;
    isSyncing: boolean;
    onSync: () => void;
    onLogout: () => void;
    onCreate: (name: string, parentId: number | null) => Promise<unknown>;
    onDelete: (id: number, name: string) => void;
    onRename: (id: number, newName: string, parentId: number | null) => void;
    bandwidth: BandwidthStats | null;
}

export function FloatingPillNav({
    folders, activeFolderId, setActiveFolderId, isConnected, isSyncing,
    onSync, onLogout, onCreate, onDelete, onRename, bandwidth,
}: FloatingPillNavProps) {
    const [showFolderPanel, setShowFolderPanel] = useState(false);
    const [showNewFolder, setShowNewFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');

    const folderBtnRef = useRef<HTMLButtonElement>(null);
    const folderPanelRef = useRef<HTMLDivElement>(null);
    const newFolderBtnRef = useRef<HTMLButtonElement>(null);
    const newFolderPanelRef = useRef<HTMLDivElement>(null);

    const tree = buildTree(folders);

    // Close folder panel on outside click (excluding the toggle button itself)
    useEffect(() => {
        if (!showFolderPanel) return;
        const handler = (e: MouseEvent) => {
            if (folderPanelRef.current?.contains(e.target as Node)) return;
            if (folderBtnRef.current?.contains(e.target as Node)) return;
            setShowFolderPanel(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showFolderPanel]);

    // Close new-folder panel on outside click
    useEffect(() => {
        if (!showNewFolder) return;
        const handler = (e: MouseEvent) => {
            if (newFolderPanelRef.current?.contains(e.target as Node)) return;
            if (newFolderBtnRef.current?.contains(e.target as Node)) return;
            setShowNewFolder(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showNewFolder]);

    const submitCreate = async () => {
        if (!newFolderName.trim()) return;
        try {
            await onCreate(newFolderName.trim(), null);
            setNewFolderName('');
            setShowNewFolder(false);
        } catch { /* handled upstream */ }
    };

    const dropdownPos = 'bottom-[72px]';

    return (
        <>
            {/* ---- Pill bar ---- */}
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-0.5 px-3 py-1.5 bg-telegram-surface/90 backdrop-blur-xl border border-telegram-border rounded-full shadow-2xl select-none">

                {/* Brand */}
                <div className="flex items-center gap-2 pr-2 mr-1">
                    <img src="/logo.svg" className="w-7 h-7 drop-shadow" alt="Logo" />
                    <span className="font-bold text-sm text-telegram-text tracking-tight whitespace-nowrap">
                        Telegram Drive
                    </span>
                </div>

                <div className="w-px h-5 bg-telegram-border mx-1" />

                {/* Home */}
                <PillButton
                    title="Saved Messages"
                    active={activeFolderId === null && !showFolderPanel}
                    onClick={() => { setActiveFolderId(null); setShowFolderPanel(false); setShowNewFolder(false); }}
                >
                    <HardDrive className="w-4 h-4" />
                </PillButton>

                {/* Folder tree toggle */}
                <PillButton
                    btnRef={folderBtnRef}
                    title="Folders"
                    active={showFolderPanel}
                    onClick={() => { setShowFolderPanel(v => !v); setShowNewFolder(false); }}
                >
                    <Folder className="w-4 h-4" />
                </PillButton>

                {/* New folder */}
                <PillButton
                    btnRef={newFolderBtnRef}
                    title="New Folder"
                    active={showNewFolder}
                    onClick={() => { setShowNewFolder(v => !v); setShowFolderPanel(false); }}
                >
                    <Plus className="w-4 h-4" />
                </PillButton>

                {/* Sync */}
                <PillButton title={isSyncing ? 'Syncing…' : 'Sync'} onClick={onSync} disabled={isSyncing}>
                    <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                </PillButton>

                {/* Bandwidth */}
                {bandwidth && (() => {
                    const total = bandwidth.up_bytes + bandwidth.down_bytes;
                    const limit = 250 * 1024 * 1024 * 1024;
                    const pct = Math.min((total / limit) * 100, 100);
                    return (
                        <div className="flex flex-col justify-center gap-0.5 px-2 min-w-[72px]" title={`${formatBytes(total)} used of 250 GB today`}>
                            <span className="text-[10px] text-telegram-subtext leading-none">Used Today</span>
                            <div className="w-full bg-telegram-border rounded-full h-1 overflow-hidden">
                                <div className="bg-telegram-primary h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px] text-telegram-subtext leading-none opacity-70">{formatBytes(total)}</span>
                        </div>
                    );
                })()}

                {/* Logout */}
                <PillButton title="Logout" onClick={onLogout} danger>
                    <LogOut className="w-4 h-4" />
                </PillButton>

                <div className="w-px h-5 bg-telegram-border mx-1" />

                {/* Live status */}
                <div className="flex items-center gap-1.5 px-1.5">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-500'}`} />
                    <span className="text-xs font-medium text-telegram-subtext whitespace-nowrap">
                        {isConnected ? 'Live' : 'Offline'}
                    </span>
                </div>
            </div>

            {/* ---- Folder tree dropdown ---- */}
            <AnimatePresence>
                {showFolderPanel && (
                    <motion.div
                        ref={folderPanelRef}
                        initial={{ opacity: 0, y: 6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.97 }}
                        transition={{ duration: 0.14, ease: 'easeOut' }}
                        className={`fixed ${dropdownPos} left-1/2 -translate-x-1/2 z-40 w-64 bg-telegram-surface/95 backdrop-blur-xl border border-telegram-border rounded-xl shadow-2xl overflow-hidden`}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-2 max-h-80 overflow-y-auto">
                            <button
                                onClick={() => { setActiveFolderId(null); setShowFolderPanel(false); }}
                                className={`w-full flex items-center gap-2 py-1.5 px-3 text-sm rounded-md transition-colors mb-0.5 ${activeFolderId === null ? 'bg-telegram-primary/20 text-telegram-primary' : 'text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text'}`}
                            >
                                <HardDrive className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>Saved Messages</span>
                            </button>
                            {tree.map(node => (
                                <FolderTreeItem
                                    key={node.id}
                                    node={node}
                                    depth={0}
                                    activeFolderId={activeFolderId}
                                    setActiveFolderId={setActiveFolderId}
                                    onClose={() => setShowFolderPanel(false)}
                                    onDelete={onDelete}
                                    onRename={onRename}
                                />
                            ))}
                            {tree.length === 0 && (
                                <p className="text-xs text-telegram-subtext text-center py-4">No folders yet</p>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ---- New folder popup ---- */}
            <AnimatePresence>
                {showNewFolder && (
                    <motion.div
                        ref={newFolderPanelRef}
                        initial={{ opacity: 0, y: 6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.97 }}
                        transition={{ duration: 0.14, ease: 'easeOut' }}
                        className={`fixed ${dropdownPos} left-1/2 -translate-x-1/2 z-40 w-72 bg-telegram-surface/95 backdrop-blur-xl border border-telegram-border rounded-xl shadow-2xl p-3`}
                        onClick={e => e.stopPropagation()}
                    >
                        <p className="text-xs text-telegram-subtext mb-2 font-medium">New Root Folder</p>
                        <div className="flex gap-2">
                            <input
                                autoFocus
                                type="text"
                                className="flex-1 bg-telegram-hover border border-telegram-border rounded-lg px-3 py-1.5 text-sm text-telegram-text placeholder:text-telegram-subtext focus:outline-none focus:border-telegram-primary/50 transition-colors"
                                placeholder="Folder name"
                                value={newFolderName}
                                onChange={e => setNewFolderName(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') submitCreate();
                                    if (e.key === 'Escape') setShowNewFolder(false);
                                }}
                            />
                            <button
                                onClick={submitCreate}
                                className="px-3 py-1.5 bg-telegram-primary text-white rounded-lg text-sm hover:bg-telegram-primary/90 transition-colors"
                            >
                                Create
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
