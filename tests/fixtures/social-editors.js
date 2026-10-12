// Actual managed editors, bundled locally only for the browser regression suite.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Editor, EditorState } from 'draft-js';
import { createEditor, $getRoot } from 'lexical';
import { registerPlainText } from '@lexical/plain-text';

function SocialEditors() {
  const [draft, setDraft] = useState(() => EditorState.createEmpty());
  const [rich, setRich] = useState({ text: '', revision: 0 });
  window.draftEditorState = draft;
  window.controlledRichText = rich.text;
  return React.createElement('section', null,
    React.createElement('h2', null, 'Actual Draft.js composer'),
    React.createElement('div', { id: 'draft-root', 'data-testid': 'tweetTextarea_0' },
      React.createElement(Editor, {
        editorState: draft,
        onChange: state => { window.draftEditorState = state; setDraft(state); },
        spellCheck: false,
      })),
    React.createElement('h2', null, 'React rich-text composer rebuilding its text span'),
    React.createElement('div', {
      id: 'react-rich', contentEditable: true, suppressContentEditableWarning: true,
      style: { whiteSpace: 'pre-wrap', minHeight: 40, border: '1px solid #777' },
      onInput: event => {
        const text = event.currentTarget.textContent;
        flushSync(() => setRich(previous => ({ text, revision: previous.revision + 1 })));
      },
    }, React.createElement('span', { key: rich.revision }, rich.text)));
}

createRoot(document.getElementById('social-react-root')).render(React.createElement(SocialEditors));
const lexical = createEditor({
  namespace: 'ShobdoLocalRegression',
  onError: error => { window.lexicalErrors.push(error.message); },
});
window.lexicalErrors = [];
lexical.setRootElement(document.getElementById('lexical-root'));
registerPlainText(lexical);
window.lexicalEditor = lexical;
window.readLexicalText = () => lexical.getEditorState().read(() => $getRoot().getTextContent());
window.socialEditorsReady = true;
