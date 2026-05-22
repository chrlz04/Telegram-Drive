import { useState } from 'react';
import { HardDrive, Folder, Plus, RefreshCw, LogOut, ChevronRight } from 'lucide-react';
import { SidebarItem } from './SidebarItem';
import { BandwidthWidget } from './BandwidthWidget';
import { TelegramFolder, BandwidthStats } from '../../types';

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

interface FolderNode extends TelegramFolder {
    children: FolderNode[];
}

function buildTree(folders: TelegramFolder[]): FolderNode[] {
    const map = new Map<number, FolderNode>();
    for (const f of folders) {
        map.set(f.id, { ...f, children: [] });
    }
    const roots: FolderNode[] = [];
    for (const node of map.values()) {
        const pid = node.parent_id;
        if (pid != null && map.has(pid)) {
            map.get(pid)!.children.push(node);
        } else {
            roots.push(node);
        }
    }
    return roots;
}

// ---------------------------------------------------------------------------
// FolderTreeNode — recursive component for one folder + its subtree
// ---------------------------------------------------------------------------

interface FolderTreeNodeProps {
    node: FolderNode;
    depth: number;
    activeFolderId: number | null;
    setActiveFolderId: (id: number | null) => void;
    onDrop: (e: React.DragEvent, folderId: number | null) => void;
    onDelete: (id: number, name: string) => void;
    onCreate: (name: string, parentId: number | null) => Promise<unknown>;
    onRename: (id: number, newName: string, parentId: number | null) => void;
}

function FolderTreeNode({
    node, depth, activeFolderId, setActiveFolderId, onDrop, onDelete, onCreate, onRename,
}: FolderTreeNodeProps) {
    const [expanded, setExpanded] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');

    const indentPx = depth * 12;
    const hasChildren = node.children.length > 0;

    const submitCreate = async () => {
        if (!newName.trim()) { setCreating(false); return; }
        try {
            await onCreate(newName.trim(), node.id);
            setNewName('');
            setCreating(false);
            setExpanded(true);
        } catch {
            // error toast is handled by useTelegramConnection
        }
    };

    const submitRename = () => {
        const trimmed = renameValue.trim();
        if (trimmed && trimmed !== node.name) {
            onRename(node.id, trimmed, node.parent_id);
        }
        setRenaming(false);
        setRenameValue('');
    };

    return (
        <div>
            {/* Row: indent + chevron + folder button */}
            <div className="flex items-center gap-0.5" style={{ paddingLeft: `${indentPx}px` }}>
                {/* Chevron — always reserve the space so items stay aligned */}
                <button
                    onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                    className={`w-5 h-5 flex-shrink-0 flex items-center justify-center rounded text-telegram-subtext hover:text-telegram-text transition-colors ${!hasChildren ? 'invisible pointer-events-none' : ''}`}
                    tabIndex={hasChildren ? 0 : -1}
                    title={expanded ? 'Collapse' : 'Expand'}
                >
                    <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
                </button>

                {/* Folder item fills the remaining width */}
                <div className="flex-1 min-w-0">
                    {renaming ? (
                        <input
                            autoFocus
                            type="text"
                            className="w-full bg-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-telegram-primary"
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') submitRename();
                                if (e.key === 'Escape') { setRenaming(false); setRenameValue(''); }
                            }}
                            onBlur={() => { setRenaming(false); setRenameValue(''); }}
                        />
                    ) : (
                        <SidebarItem
                            icon={Folder}
                            label={node.name}
                            active={activeFolderId === node.id}
                            onClick={() => setActiveFolderId(node.id)}
                            onDrop={(e: React.DragEvent) => onDrop(e, node.id)}
                            onDelete={() => onDelete(node.id, node.name)}
                            onAddChild={() => { setCreating(true); setExpanded(true); }}
                            onRename={() => { setRenameValue(node.name); setRenaming(true); }}
                            folderId={node.id}
                        />
                    )}
                </div>
            </div>

            {/* Children + inline subfolder creation input */}
            {expanded && (
                <div>
                    {node.children.map(child => (
                        <FolderTreeNode
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            activeFolderId={activeFolderId}
                            setActiveFolderId={setActiveFolderId}
                            onDrop={onDrop}
                            onDelete={onDelete}
                            onCreate={onCreate}
                            onRename={onRename}
                        />
                    ))}

                    {creating && (
                        <div style={{ paddingLeft: `${indentPx + 12 + 20}px` }} className="pr-2 py-1">
                            <input
                                autoFocus
                                type="text"
                                className="w-full bg-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-telegram-primary"
                                placeholder="Subfolder name"
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') submitCreate();
                                    if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                                }}
                                onBlur={() => { if (!newName.trim()) setCreating(false); }}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

interface SidebarProps {
    folders: TelegramFolder[];
    activeFolderId: number | null;
    setActiveFolderId: (id: number | null) => void;
    onDrop: (e: React.DragEvent, folderId: number | null) => void;
    onDelete: (id: number, name: string) => void;
    onCreate: (name: string, parentId: number | null) => Promise<unknown>;
    onRename: (id: number, newName: string, parentId: number | null) => void;
    isSyncing: boolean;
    isConnected: boolean;
    onSync: () => void;
    onLogout: () => void;
    bandwidth: BandwidthStats | null;
}

export function Sidebar({
    folders, activeFolderId, setActiveFolderId, onDrop, onDelete, onCreate, onRename,
    isSyncing, isConnected, onSync, onLogout, bandwidth
}: SidebarProps) {
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');

    const tree = buildTree(folders);

    const submitCreate = async () => {
        if (!newFolderName.trim()) return;
        try {
            await onCreate(newFolderName.trim(), null); // null = root folder
            setNewFolderName('');
            setShowNewFolderInput(false);
        } catch {
            // handled by parent
        }
    };

    return (
        <aside className="w-64 bg-telegram-surface border-r border-telegram-border flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 flex items-center gap-2">
                <img src="/logo.svg" className="w-8 h-8 drop-shadow-lg" alt="Logo" />
                <span className="font-bold text-lg text-telegram-text tracking-tight">Telegram Drive</span>
            </div>

            {/* Scrollable folder tree */}
            <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto min-h-0">
                <SidebarItem
                    icon={HardDrive}
                    label="Saved Messages"
                    active={activeFolderId === null}
                    onClick={() => setActiveFolderId(null)}
                    onDrop={(e: React.DragEvent) => onDrop(e, null)}
                    folderId={null}
                />
                {tree.map(node => (
                    <FolderTreeNode
                        key={node.id}
                        node={node}
                        depth={0}
                        activeFolderId={activeFolderId}
                        setActiveFolderId={setActiveFolderId}
                        onDrop={onDrop}
                        onDelete={onDelete}
                        onCreate={onCreate}
                        onRename={onRename}
                    />
                ))}
            </nav>

            {/* Sticky Create Root Folder section */}
            <div className="px-2 pb-2 border-b border-telegram-border">
                {showNewFolderInput ? (
                    <div className="px-3 py-2">
                        <input
                            autoFocus
                            type="text"
                            className="w-full bg-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-telegram-primary"
                            placeholder="Folder name"
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submitCreate()}
                            onBlur={() => !newFolderName && setShowNewFolderInput(false)}
                        />
                    </div>
                ) : (
                    <button
                        onClick={() => setShowNewFolderInput(true)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text transition-colors border border-dashed border-telegram-border"
                    >
                        <Plus className="w-4 h-4" />
                        Create Folder
                    </button>
                )}
            </div>

            <div className="p-4 border-t border-telegram-border">
                <div className="flex items-center gap-2 text-telegram-subtext text-xs">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                    <span>{isConnected ? 'Connected to Telegram' : 'Disconnected from Telegram'}</span>
                </div>

                <div className="flex gap-2 mt-4">
                    <button
                        onClick={onSync}
                        disabled={isSyncing}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-blue-500 hover:text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="Scan for existing folders"
                    >
                        <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Syncing...' : 'Sync'}
                    </button>
                    <button
                        onClick={onLogout}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-red-500 hover:text-red-600 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                        title="Sign Out"
                    >
                        <LogOut className="w-3 h-3" />
                        Logout
                    </button>
                </div>

                {bandwidth && <BandwidthWidget bandwidth={bandwidth} />}
            </div>
        </aside>
    );
}
