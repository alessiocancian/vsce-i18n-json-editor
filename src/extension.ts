import * as vscode from "vscode";
import * as _path from "path";

import { IJEManager } from "./i18n-json-editor/ije-manager";
import { IJEEditorProvider } from "./i18n-json-editor/ije-editor-provider";
import { IJEConfiguration } from "./i18n-json-editor/ije-configuration";

export function activate(context: vscode.ExtensionContext) {

  if (IJEConfiguration.FOLDERS) {
    let myStatusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    myStatusBarItem.command = "i18n-json-editor";
    myStatusBarItem.text = `$(symbol-string) i18n editor`;
    myStatusBarItem.show();
  }

  context.subscriptions.push(IJEEditorProvider.register(context));
}
