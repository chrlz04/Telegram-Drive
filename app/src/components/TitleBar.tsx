import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function TitleBar() {
    const [isFullscreen, setIsFullscreen] = useState(false);

    const win = getCurrentWindow();

    useEffect(() => {
        win.isFullscreen().then(setIsFullscreen);

        const unlistenResize = win.onResized(async () => {
            setIsFullscreen(await win.isFullscreen());
        });

        return () => { unlistenResize.then(fn => fn()); };
    }, [win]);

    // F11 toggles fullscreen
    useEffect(() => {
        const onKey = async (e: KeyboardEvent) => {
            if (e.key === 'F11') {
                e.preventDefault();
                const full = await win.isFullscreen();
                await win.setFullscreen(!full);
                setIsFullscreen(!full);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [win]);

    // Hide the bar entirely in fullscreen — content fills the whole screen
    if (isFullscreen) return null;

    return (
        <div
            className="flex items-center h-9 bg-telegram-bg border-b border-telegram-border/50 select-none flex-shrink-0"
            data-tauri-drag-region=""
        >
            {/* App branding — pointer-events none so the whole bar is draggable */}
            <div className="flex items-center gap-2 pl-3 pointer-events-none">
                <div className="w-4 h-4 rounded-sm bg-telegram-primary/80 flex items-center justify-center flex-shrink-0">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                </div>
                <span className="text-[11px] font-medium text-telegram-subtext tracking-wide">
                    Telegram Drive
                </span>
            </div>

            {/* Rest of bar is a drag region */}
            <div className="flex-1 h-full" data-tauri-drag-region="" />
        </div>
    );
}
