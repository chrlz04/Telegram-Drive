import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { QueueItem, TelegramFolder } from '../types';
import { useFileDrop } from './useFileDrop';
import { useSettings } from '../context/SettingsContext';
import type { Store } from '@tauri-apps/plugin-store';

interface ProgressPayload {
    id: string;
    percent: number;
    uploaded_bytes: number;
    total_bytes: number;
    speed_bytes_per_sec: number;
}

export function useFileUpload(
    activeFolderId: number | null,
    store: Store | null,
    onCreateFolder: ((name: string, parentId: number | null) => Promise<TelegramFolder>) | null = null,
) {
    const queryClient = useQueryClient();
    const { settings } = useSettings();
    const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);
    const [processing, setProcessing] = useState(false);
    const [initialized, setInitialized] = useState(false);
    const cancelledRef = useRef<Set<string>>(new Set());

    // Keep a ref so drag-drop callback always reads the latest active folder
    // without needing useCallback / effect re-registration.
    const activeFolderIdRef = useRef(activeFolderId);
    useEffect(() => { activeFolderIdRef.current = activeFolderId; }, [activeFolderId]);

    // Listen for progress events from Rust
    useEffect(() => {
        let cancelled = false;
        let unlisten: UnlistenFn | undefined;
        listen<ProgressPayload>('upload-progress', (event) => {
            setUploadQueue(q => q.map(i =>
                i.id === event.payload.id ? {
                    ...i,
                    progress: event.payload.percent,
                    uploadedBytes: event.payload.uploaded_bytes,
                    totalBytes: event.payload.total_bytes,
                    speedBytesPerSec: event.payload.speed_bytes_per_sec,
                } : i
            ));
        }).then(fn => {
            if (cancelled) { fn(); } else { unlisten = fn; }
        });
        return () => { cancelled = true; unlisten?.(); };
    }, []);

    useEffect(() => {
        if (!store || initialized) return;
        store.get<QueueItem[]>('uploadQueue').then((saved) => {
            if (saved && saved.length > 0) {
                const pending = saved.filter(i => i.status === 'pending');
                if (pending.length > 0) {
                    setUploadQueue(pending);
                    toast.info(`Restored ${pending.length} pending uploads`);
                }
            }
            setInitialized(true);
        });
    }, [store, initialized]);

    useEffect(() => {
        if (!store || !initialized) return;
        const pending = uploadQueue.filter(i => i.status === 'pending');
        store.set('uploadQueue', pending).then(() => store.save());
    }, [store, uploadQueue, initialized]);

    useEffect(() => {
        if (processing) return;
        const nextItem = uploadQueue.find(i => i.status === 'pending');
        if (nextItem) {
            processItem(nextItem);
        }
    }, [uploadQueue, processing]);

    /** Clean up temp zip file if the item was created from a folder */
    const cleanupTempZip = async (item: QueueItem) => {
        if (item.tempZipPath) {
            try {
                await invoke('cmd_delete_temp_zip', { path: item.tempZipPath });
            } catch {
                // Best-effort cleanup
            }
        }
    };

    const processItem = async (item: QueueItem) => {
        setProcessing(true);
        setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'uploading', progress: 0 } : i));
        try {
            await invoke('cmd_upload_file', { path: item.path, folderId: item.folderId, transferId: item.id });
            // Check if cancelled during upload
            if (cancelledRef.current.has(item.id)) {
                cancelledRef.current.delete(item.id);
            } else {
                setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'success', progress: 100 } : i));
                queryClient.invalidateQueries({ queryKey: ['files', item.folderId] });
            }
            // Clean up temp zip on success
            await cleanupTempZip(item);
        } catch (e) {
            if (!cancelledRef.current.has(item.id)) {
                const errMsg = String(e);
                if (errMsg.includes('Transfer cancelled')) {
                    setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'cancelled' } : i));
                } else if (errMsg.includes('FILE_TOO_BIG') || errMsg.includes('too large') || errMsg.includes('2 GB')) {
                    setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'error', error: errMsg } : i));
                    toast.error(`Upload failed: Telegram has a 2 GB file size limit. Try splitting large folders.`);
                } else {
                    setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'error', error: errMsg } : i));
                    toast.error(`Upload failed for ${item.path.split('/').pop()}: ${e}`);
                }
            } else {
                cancelledRef.current.delete(item.id);
            }
            // Clean up temp zip even on failure
            await cleanupTempZip(item);
        } finally {
            setProcessing(false);
        }
    };

    const handleManualUpload = async () => {
        try {
            const selected = await open({ multiple: true, directory: false });
            if (selected) {
                const paths = Array.isArray(selected) ? selected : [selected];
                const newItems: QueueItem[] = paths.map((path: string) => ({
                    id: Math.random().toString(36).substr(2, 9),
                    path,
                    folderId: activeFolderId,
                    status: 'pending'
                }));
                setUploadQueue(prev => [...prev, ...newItems]);
                toast.info(`Queued ${paths.length} files for upload`);
            }
        } catch {
            toast.error("Failed to open file dialog");
        }
    };

    const handleFolderUpload = async () => {
        try {
            const selected = await open({ multiple: false, directory: true, title: 'Select Folder to Upload' });
            if (!selected) return;

            const folderPath = Array.isArray(selected) ? selected[0] : selected;
            if (!folderPath) return;

            const folderName = folderPath.split('/').pop() || folderPath.split('\\').pop() || 'folder';

            if (settings.zipFolders) {
                toast.info(`Zipping "${folderName}"...`);
                try {
                    const zipPath = await invoke<string>('cmd_zip_folder', { folderPath });
                    const item: QueueItem = {
                        id: Math.random().toString(36).substr(2, 9),
                        path: zipPath,
                        folderId: activeFolderId,
                        status: 'pending',
                        tempZipPath: zipPath,
                    };
                    setUploadQueue(prev => [...prev, item]);
                    toast.success(`Queued "${folderName}.zip" for upload`);
                } catch (e) {
                    toast.error(`Failed to zip folder: ${e}`);
                }
            } else {
                toast.info(`Folder upload without zipping is not supported. Enable "Zip folders before upload" in Settings.`);
            }
        } catch {
            toast.error("Failed to open folder dialog");
        }
    };

    const cancelAll = () => {
        setUploadQueue(q => {
            const uploading = q.find(i => i.status === 'uploading');
            if (uploading) {
                cancelledRef.current.add(uploading.id);
                invoke('cmd_cancel_transfer', { transferId: uploading.id }).catch(() => {});
            }
            return q
                .filter(i => i.status !== 'pending')
                .map(i => i.status === 'uploading' ? { ...i, status: 'cancelled' as const } : i);
        });
        toast.info('All uploads cancelled');
    };

    const cancelItem = (id: string) => {
        setUploadQueue(q => {
            const item = q.find(i => i.id === id);
            if (item?.status === 'uploading') {
                cancelledRef.current.add(id);
                invoke('cmd_cancel_transfer', { transferId: id }).catch(() => {});
                return q.map(i => i.id === id ? { ...i, status: 'cancelled' as const } : i);
            }
            // Remove pending items directly
            if (item?.status === 'pending') {
                return q.filter(i => i.id !== id);
            }
            return q;
        });
    };

    const retryItem = (id: string) => {
        setUploadQueue(q => q.map(i =>
            i.id === id && (i.status === 'error' || i.status === 'cancelled')
                ? { ...i, status: 'pending' as const, error: undefined, progress: undefined, uploadedBytes: undefined, totalBytes: undefined, speedBytesPerSec: undefined }
                : i
        ));
    };

    // ------------------------------------------------------------------
    // OS drag-and-drop handler
    // Called by useFileDrop when the user drops files/folders from Explorer
    // or Finder onto the app window.
    // ------------------------------------------------------------------
    const handleDroppedPaths = async (paths: string[]) => {
        const folderId = activeFolderIdRef.current;
        const newItems: QueueItem[] = [];

        // Normalise separators so Windows backslashes and Unix slashes compare equally.
        const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '');

        // Some OS / Explorer builds include a folder's children alongside the folder
        // itself when the user drags a mixed selection.  Remove any path that is a
        // descendant of another path in the same drop — processDir handles children.
        const topLevel = paths.filter(p =>
            !paths.some(other => other !== p && norm(p).startsWith(norm(other) + '/'))
        );

        // ------------------------------------------------------------------
        // Recursive helper: create a Telegram Drive channel for `dirPath`
        // under `parentFolderId`, then walk every child entry:
        //   • files       → queued for upload into this channel
        //   • sub-dirs    → recurse (creates another channel, and so on)
        //
        // `depth` guards against pathological cases (circular symlinks,
        // absurdly deep trees).  Hard-capped at MAX_DIR_DEPTH levels.
        // ------------------------------------------------------------------
        const MAX_DIR_DEPTH = 20;

        async function processDir(
            dirPath: string,
            parentFolderId: number | null,
            depth: number,
        ): Promise<void> {
            if (depth > MAX_DIR_DEPTH) {
                toast.warning(`Skipping deeply nested folder (depth > ${MAX_DIR_DEPTH}): ${dirPath}`);
                return;
            }

            const name = dirPath.split(/[\\/]/).filter(Boolean).pop() ?? 'folder';

            if (!onCreateFolder) {
                // No folder-creation capability — fall back to zipping
                if (settings.zipFolders) {
                    toast.info(`Zipping "${name}"…`);
                    try {
                        const zipPath = await invoke<string>('cmd_zip_folder', { folderPath: dirPath });
                        newItems.push({
                            id: Math.random().toString(36).slice(2, 11),
                            path: zipPath,
                            folderId: parentFolderId,
                            status: 'pending',
                            tempZipPath: zipPath,
                        });
                    } catch (e) {
                        toast.error(`Failed to zip "${name}": ${e}`);
                    }
                } else {
                    toast.info(`Cannot upload folder "${name}" — connect your account first.`);
                }
                return;
            }

            try {
                const folder = await onCreateFolder(name, parentFolderId);
                const entries = await invoke<{ path: string; is_dir: boolean }[]>(
                    'cmd_list_dir_entries', { path: dirPath }
                ).catch(() => [] as { path: string; is_dir: boolean }[]);

                for (const entry of entries) {
                    if (entry.is_dir) {
                        // Recurse into sub-directory
                        await processDir(entry.path, folder.id, depth + 1);
                    } else {
                        newItems.push({
                            id: Math.random().toString(36).slice(2, 11),
                            path: entry.path,
                            folderId: folder.id,
                            status: 'pending',
                        });
                    }
                }

                if (entries.length === 0) {
                    toast.info(`Folder "${name}" created (empty).`);
                }
            } catch (e) {
                toast.error(`Failed to process folder "${name}": ${e}`);
            }
        }

        for (const path of topLevel) {
            const isDir = await invoke<boolean>('cmd_is_directory', { path }).catch(() => false);
            if (isDir) {
                await processDir(path, folderId, 0);
            } else {
                // Regular file — queue directly into the active folder
                newItems.push({
                    id: Math.random().toString(36).slice(2, 11),
                    path,
                    folderId,
                    status: 'pending',
                });
            }
        }

        if (newItems.length > 0) {
            setUploadQueue(prev => [...prev, ...newItems]);
            const fileCount  = newItems.filter(i => !i.tempZipPath).length;
            const folderCount = newItems.filter(i =>  i.tempZipPath).length;
            const parts: string[] = [];
            if (fileCount  > 0) parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
            if (folderCount > 0) parts.push(`${folderCount} folder${folderCount > 1 ? 's' : ''}`);
            toast.info(`Queued ${parts.join(' and ')} for upload`);
        }
    };

    const { isDragging } = useFileDrop(handleDroppedPaths);

    return {
        uploadQueue,
        setUploadQueue,
        handleManualUpload,
        handleFolderUpload,
        cancelAll,
        cancelItem,
        retryItem,
        isDragging
    };
}
