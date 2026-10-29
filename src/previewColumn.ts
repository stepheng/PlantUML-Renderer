export interface GroupInfo {
    viewColumn: number;
    /** The group holding the editor the preview was opened from */
    isActive: boolean;
    webviewTypes: string[];
}

/**
 * Join a group that already shows a preview (Markdown's, say) instead of
 * splitting off a new one. Undefined means "open beside the source".
 */
export function previewColumn(groups: GroupInfo[]): number | undefined {
    return groups.find(g => !g.isActive && g.webviewTypes.some(t => /preview/i.test(t)))?.viewColumn;
}
