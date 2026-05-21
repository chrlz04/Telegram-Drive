import { useState, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * useFileDrop — listens for OS-level file/folder drag-drop events via Tauri.
 *
 * Requires dragDropEnabled: true in tauri.conf.json.
 * Tauri intercepts the OS drop and fires onDragDropEvent instead of letting
 * the DOM see it, so internal file-move drag events (which start inside the
 * WebView) are completely unaffected.
 *
 * @param onFilesDropped  Called with the array of dropped paths when the user
 *                        releases files/folders onto the window.  The callback
 *                        is stored in a ref so the event listener is registered
 *                        only once (on mount) and never needs to re-subscribe.
 */
export function useFileDrop(onFilesDropped: (paths: string[]) => void) {
    const [isDragging, setIsDragging] = useState(false);

    // Keep a ref so the listener closure always calls the latest callback
    // without needing to be re-registered when the caller re-renders.
    const callbackRef = useRef(onFilesDropped);
    callbackRef.current = onFilesDropped;

    useEffect(() => {
        // `cancelled` is set to true by the cleanup closure so that if the
        // cleanup runs before the onDragDropEvent Promise resolves (which
        // happens in React 18 Strict Mode and on any remount), the unlisten
        // call still happens as soon as the Promise does resolve — preventing
        // a second "ghost" listener from accumulating and doubling every drop.
        let cancelled = false;
        let unlistenFn: (() => void) | undefined;

        getCurrentWindow()
            .onDragDropEvent((event) => {
                switch (event.payload.type) {
                    case 'enter':
                        // Files are hovering over the window — show the drop overlay
                        setIsDragging(true);
                        break;

                    case 'leave':
                        // Drag left the window without dropping
                        setIsDragging(false);
                        break;

                    case 'drop':
                        // User released — hand paths to the upload handler
                        setIsDragging(false);
                        if (event.payload.paths.length > 0) {
                            callbackRef.current(event.payload.paths);
                        }
                        break;

                    // 'over' fires continuously while hovering — we don't need it
                    default:
                        break;
                }
            })
            .then((fn) => {
                if (cancelled) {
                    // Cleanup already ran while the Promise was in-flight —
                    // unlisten immediately so no ghost listener is left behind.
                    fn();
                } else {
                    unlistenFn = fn;
                }
            });

        return () => {
            cancelled = true;
            unlistenFn?.();
        };
    }, []); // register once on mount, never re-run

    return { isDragging };
}
