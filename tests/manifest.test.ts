import * as manifest from '../package.json';

test('Alt+D opens the preview from a PlantUML editor', () => {
    expect(manifest.contributes.keybindings).toContainEqual({
        command: 'plantumlRenderer.preview',
        key: 'alt+d',
        when: 'editorLangId == plantuml || editorLangId == plantuml-include',
    });
});
