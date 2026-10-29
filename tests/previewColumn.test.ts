import { previewColumn } from '../src/previewColumn';

describe('previewColumn', () => {
    test('joins a group that already shows a Markdown preview', () => {
        expect(previewColumn([
            { viewColumn: 1, isActive: true, webviewTypes: [] },
            { viewColumn: 2, isActive: false, webviewTypes: ['mainThreadWebview-markdown.preview'] },
        ])).toBe(2);
    });

    test('opens beside the source when no other group shows a preview', () => {
        expect(previewColumn([
            { viewColumn: 1, isActive: true, webviewTypes: [] },
            { viewColumn: 2, isActive: false, webviewTypes: ['mainThreadWebview-settings'] },
        ])).toBeUndefined();
    });

    test('never covers the source editor, even if its group has a preview tab', () => {
        expect(previewColumn([
            { viewColumn: 1, isActive: true, webviewTypes: ['mainThreadWebview-markdown.preview'] },
        ])).toBeUndefined();
    });

    test('picks the first matching group when several show previews', () => {
        expect(previewColumn([
            { viewColumn: 1, isActive: false, webviewTypes: ['mainThreadWebview-markdown.preview'] },
            { viewColumn: 2, isActive: true, webviewTypes: [] },
            { viewColumn: 3, isActive: false, webviewTypes: ['mainThreadWebview-markdown.preview'] },
        ])).toBe(1);
    });
});
