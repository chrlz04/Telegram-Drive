import { useEffect, useRef, useState } from 'react';
import { Plus, FolderPlus, Pencil, Trash2 } from 'lucide-react';

interface SidebarItemProps {
    icon: React.ElementType;
    label: string;
    active: boolean;
    onClick: () => void;
    onDrop: (e: React.DragEvent) => void;
    onDelete?: () => void;
    onAddChild?: () => void;
    onRename?: () => void;
    folderId: number | null;
}

export function SidebarItem({ icon: Icon, label, active = false, onClick, onDrop, onDelete, onAddChild, onRename }: SidebarItemProps) {
    const [isOver, setIsOver] = useState(false);
    const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
    const ctxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ctxMenu) return;
        const handleMouseDown = (e: MouseEvent) => {
            // Only close if the click is outside the context menu itself
            if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
                setCtxMenu(null);
            }
        };
        const handleResize = () => setCtxMenu(null);
        const handleContextMenu = (e: MouseEvent) => {
            if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
                setCtxMenu(null);
            }
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('contextmenu', handleContextMenu);
        window.addEventListener('resize', handleResize);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('contextmenu', handleContextMenu);
            window.removeEventListener('resize', handleResize);
        };
    }, [ctxMenu]);

    return (
        <div className="relative">
            <button
                onClick={onClick}
                onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsOver(true);
                }}
                onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                }}
                onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX;
                    const y = e.clientY;
                    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                        setIsOver(false);
                    }
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsOver(false);
                    if (onDrop) onDrop(e);
                }}
                onContextMenu={(e) => {
                    if (onDelete || onRename) {
                        e.preventDefault();
                        e.stopPropagation();
                        setCtxMenu({ x: e.clientX, y: e.clientY });
                    }
                }}
                className={`group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${active
                    ? 'bg-telegram-primary/10 text-telegram-primary'
                    : isOver
                        ? 'bg-telegram-primary/30 text-telegram-text ring-2 ring-telegram-primary scale-[1.02] shadow-lg'
                        : 'text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text'
                    }`}
            >
                <Icon className={`w-4 h-4 ${isOver ? 'text-telegram-primary' : ''}`} />
                <span className="flex-1 text-left truncate">{label}</span>
                {onAddChild && (
                    <div onClick={(e) => { e.stopPropagation(); onAddChild(); }} className="opacity-0 group-hover:opacity-100 p-1 hover:text-telegram-primary" title="New subfolder">
                        <FolderPlus className="w-3 h-3" />
                    </div>
                )}
                {onDelete && (
                    <div onClick={(e) => { e.stopPropagation(); onDelete(); }} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400">
                        <Plus className="w-3 h-3 rotate-45" />
                    </div>
                )}
            </button>

            {ctxMenu && (
                <div
                    ref={ctxRef}
                    className="fixed z-50 min-w-[150px] bg-telegram-surface/95 backdrop-blur-xl border border-telegram-border rounded-lg shadow-2xl p-1.5 flex flex-col gap-0.5"
                    style={{ left: ctxMenu.x, top: ctxMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    {onRename && (
                        <button
                            onClick={() => { onRename(); setCtxMenu(null); }}
                            className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full"
                        >
                            <Pencil className="w-4 h-4 text-telegram-primary" />
                            Rename
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={() => { onDelete(); setCtxMenu(null); }}
                            className="flex items-center gap-2 px-2 py-1.5 text-sm text-red-500 hover:bg-red-500/10 rounded transition-colors text-left w-full"
                        >
                            <Trash2 className="w-4 h-4" />
                            Delete
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
