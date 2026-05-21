import { Plus, HardDrive, Folder } from 'lucide-react';
import { TelegramFolder } from '../../types';

// ---------------------------------------------------------------------------
// Tree helpers (shared pattern with Sidebar)
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

/** Depth-first flattening so the modal renders folders in natural tree order. */
function flattenTree(
    nodes: FolderNode[],
    depth = 0,
): Array<{ folder: TelegramFolder; depth: number }> {
    return nodes.flatMap(n => [
        { folder: n, depth },
        ...flattenTree(n.children, depth + 1),
    ]);
}

// ---------------------------------------------------------------------------
// MoveToFolderModal
// ---------------------------------------------------------------------------

interface MoveToFolderModalProps {
    folders: TelegramFolder[];
    onClose: () => void;
    onSelect: (id: number | null) => void;
    activeFolderId: number | null;
}

export function MoveToFolderModal({ folders, onClose, onSelect, activeFolderId }: MoveToFolderModalProps) {
    const flatFolders = flattenTree(buildTree(folders));

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-telegram-surface border border-telegram-border rounded-xl w-80 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-telegram-border flex justify-between items-center">
                    <h3 className="text-telegram-text font-medium">Move to Folder</h3>
                    <button onClick={onClose} className="text-telegram-subtext hover:text-telegram-text"><Plus className="w-5 h-5 rotate-45" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {/* Saved Messages (root) */}
                    {activeFolderId !== null && (
                        <button
                            onClick={() => onSelect(null)}
                            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-left text-telegram-text hover:bg-telegram-hover transition-colors"
                        >
                            <div className="w-8 h-8 rounded bg-telegram-primary/20 flex items-center justify-center text-telegram-primary flex-shrink-0">
                                <HardDrive className="w-4 h-4" />
                            </div>
                            <span className="font-medium">Saved Messages</span>
                        </button>
                    )}

                    {/* Folders in tree order with depth-based indentation */}
                    {flatFolders.map(({ folder: f, depth }) => {
                        if (f.id === activeFolderId) return null;
                        return (
                            <button
                                key={f.id}
                                onClick={() => onSelect(f.id)}
                                className="w-full flex items-center gap-3 py-3 pr-3 rounded-lg text-sm text-left text-telegram-text hover:bg-telegram-hover transition-colors"
                                style={{ paddingLeft: `${12 + depth * 16}px` }}
                            >
                                <div className="w-8 h-8 rounded bg-telegram-hover flex items-center justify-center text-telegram-text flex-shrink-0">
                                    <Folder className="w-4 h-4" />
                                </div>
                                <span className="font-medium truncate">{f.name}</span>
                            </button>
                        );
                    })}

                    {folders.length === 0 && activeFolderId === null && (
                        <div className="p-4 text-center text-xs text-telegram-subtext">No other folders available. Create one first!</div>
                    )}
                </div>
            </div>
        </div>
    );
}
