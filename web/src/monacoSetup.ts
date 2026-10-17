/**
 * Bundles Monaco with the app instead of letting `@monaco-editor/react` fetch it
 * from a CDN at runtime. Only the core editor and the Python language are
 * included, which keeps the bundle small and works behind restrictive networks.
 *
 * Loaded lazily from `App.tsx` together with the editor panel; never import it
 * from components or tests.
 */
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/python/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });
