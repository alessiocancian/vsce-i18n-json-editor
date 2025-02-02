import * as vscode from "vscode";
import * as fs from "fs";
import * as _path from "path";

import { IJEManager } from "./ije-manager";

import { IJEDataTranslation } from "./models/ije-data-translation";
import { IJEDataTranslationError } from "./models/ije-data-translation-error";
import { IJEPage } from "./models/ije-page";
import { IJESort } from "./models/ije-sort";
import { IJEView, IJEViewType } from "./models/ije-view";
import { IJEDataRenderUtil } from "./ije-data-render-util";
import { IJEConfiguration } from "./ije-configuration";

export class IJEData {
  private _currentID = 1;

  private _languages: string[] = [];
  private _translations: IJEDataTranslation[] = [];

  private _searchPattern: string = "";
  private _filteredFolder: string = "*";

  private _view: IJEView;
  private _page: IJEPage;
  private _sort: IJESort;

  get languages() {
    return this.languages;
  }
  get translations() {
    return this._translations;
  }

  constructor(private _manager: IJEManager) {
    this._loadFiles();
    this._defaultValues();
  }

  private _defaultValues() {
    this._view = {
      type: IJEViewType.TABLE,
      selectionId: 1,
    };

    this._sort = {
      column: "KEY",
      ascending: true,
    };

    this._page = {
      pageSize: 10,
      pageNumber: 1,
    };
  }

  private _loadFiles() {
    if (!this._manager.isWorkspace) {
      this._loadFolder(this._manager.folderPath);
    } else {
      const directories = IJEConfiguration.FOLDERS;
      directories.forEach((d) => {
        this._loadFolder(d.path);
      });
    }
  }

  private _stripBOM(content: string): string{
    if(!content.startsWith("\uFEFF")){
      return content;
    }
    
    return content.replace("\uFEFF", '');  
  }

  private _loadFolder(folderPath: string) {
    const files = fs.readdirSync(folderPath);

    const translate: any = {};
    const keys: string[] = [];
    files
      .filter((f) => f.endsWith(".json"))
      .forEach((file: string) => {
        var language = file;
        if (this._languages.indexOf(language) === -1) {
          this._languages.push(language);
        }

        try {
          let rawdata = fs.readFileSync(_path.join(folderPath, file));
          let jsonData = this._stripBOM(rawdata.toString());
          let content = JSON.parse(jsonData);

          let keysValues = this._getKeysValues(content);

          for (let key in keysValues) {
            if (keys.indexOf(key) === -1) {
              keys.push(key);
            }
          }
          translate[language] = keysValues;
        } catch (e) { }
      });

    keys.forEach((key: string) => {
      const languages: any = {};
      this._languages.forEach((language: string) => {
        const value = translate[language][key];
        languages[language] = value ? value : "";
      });

      const t = this._createFactoryIJEDataTranslation();
      t.folder = folderPath;
      t.key = key;
      t.languages = languages;
      this._insert(t);
    });
  }

  add() {
    const translation = this._createFactoryIJEDataTranslation();
    this._insert(translation);
    this._view.selectionId = translation.id;
    this._manager.refreshDataTable();
    // this.sort('KEY', true, true);
  }

  mark(id: number) {
    const translation = this._get(id);
    if (translation) {
      this._view.selectionId = id;
    }
  }

  navigate(page: number) {
    this._page.pageNumber = page;
    this._manager.refreshDataTable();
  }

  pageSize(pageSize: number) {
    if (pageSize > 0 && pageSize % 10 === 0) {
      this._page.pageSize = pageSize;
      this._manager.refreshDataTable();
    }
  }

  render() {
    let render = "";
    let translations = this._getDisplayedTranslations();

    switch (this._view.type) {
      case IJEViewType.LIST:
        render += IJEDataRenderUtil.renderList(translations, this._get(this._view.selectionId), this._languages, this._page, this._sort, this._manager.isWorkspace);
        break;
      case IJEViewType.TABLE:
        render += IJEDataRenderUtil.renderTable(translations, this._languages, this._page, this._sort, this._manager.isWorkspace);
        break;
    }

    return render;
  }

  remove(id: number) {
    const index = this._getIndex(id);
    if (index > -1) {
      this._validateImpacted(this._get(id));
      this._translations.splice(index, 1);

      this._manager.refreshDataTable();
    }
  }

  save() {
    //clean jsons
    let existingFolders = [];
    if (this._manager.folderPath) {
      existingFolders.push(this._manager.folderPath);
    } else {
      existingFolders = IJEConfiguration.FOLDERS.map((d) => d.path);
    }
    existingFolders.forEach((d) => {
      this._languages.forEach((language) => {
        const json = JSON.stringify({}, null, IJEConfiguration.JSON_SPACE);
        const f = vscode.Uri.file(_path.join(d, language)).fsPath;
        fs.writeFileSync(f, json);
      });
    });

    //
    let folders: { [key: string]: IJEDataTranslation[] } = this.translations.reduce((r, a) => {
      r[a.folder] = r[a.folder] || [];
      r[a.folder].push(a);
      return r;
    }, {});

    Object.entries(folders).forEach((entry) => {
      const [key, value] = entry;
      this._languages.forEach((language) => {
        let o = {};

        value
          .filter((translation) => translation.valid)
          .sort((a, b) => (a.key > b.key ? 1 : -1))
          .forEach((translation) => {
            if (translation.languages[language]) {
              this._transformKeysValues(translation.key, translation.languages[language], o);
            }
          });

        const json = JSON.stringify(o, null, IJEConfiguration.JSON_SPACE);
        const f = vscode.Uri.file(_path.join(key, language)).fsPath;
        fs.writeFileSync(f, json);
      });
    });
    vscode.window.showInformationMessage('i18n files saved');
  }

  filterFolder(value: string) {
    this._filteredFolder = value;
    this._manager.refreshDataTable();
  }

  search(value: string) {
    this._searchPattern = value;
    this._manager.refreshDataTable();
  }

  select(id: number) {
    const translation = this._get(id);
    if (translation) {
      this._view.selectionId = translation.id;

      this._manager.refreshDataTable();
    }
  }
  sort(column: string, ascending: boolean, firstPage: boolean = false) {
    this._sort.ascending = this._sort.column !== column ? true : ascending;
    this._sort.column = column;

    if (firstPage) {
      this.navigate(1);
    } else {
      this._manager.refreshDataTable();
    }
  }

  update(id: number, value: string, language: string = ""): IJEDataTranslation {
    const translation = this._get(id);
    if (translation) {
      this._view.selectionId = id;
      if (language) {
        translation.languages[language] = value.replace(/\\n/g, "\n");
        this._validate(translation);
      } else {
        const newKey = IJEConfiguration.FORCE_KEY_UPPERCASE ? value.toUpperCase() : value;
        const oldKey = translation.key;

        translation.key = newKey;

        if (oldKey !== newKey) {
          this._validateImpacted(translation, oldKey);
        }
        this._validate(translation, true);
      }
    }
    this._manager.updateTranslation(translation);
    return translation;
  }

  changeFolder(id: number, value: string) {
    const translation = this._get(id);
    translation.folder = value;
    this._validate(translation, true);
    this._manager.updateTranslation(translation);
    return translation;
  }

  switchView(view: IJEViewType) {
    this._view.type = view;
    this._manager.refreshDataTable();
  }

  private _transformKeysValues(key: string, value: string, o = {}) {
    let dot = IJEConfiguration.KEY_SEPARATOR ? key.indexOf(IJEConfiguration.KEY_SEPARATOR) : -1
    if (dot > 0) {
      const _key = key.substring(0, dot);
      if (!o[_key]) {
        o[_key] = {};
      }
      this._transformKeysValues(key.substring(dot + 1), value, o[_key]);
    } else if (!o[key] && typeof o !== "string") {
      o[key] = value;
    }
  }

  private _getKeysValues(obj: any, _key = "") {
    let kv: any = {};
    for (let key in obj) {
      if (typeof obj[key] !== "string") {
        kv = { ...kv, ...this._getKeysValues(obj[key], _key + key + (IJEConfiguration.KEY_SEPARATOR || "")) };
      } else {
        kv[_key + key] = obj[key];
      }
    }
    return kv;
  }

  private _get(id: number): IJEDataTranslation {
    return this._translations.find((t) => t.id === id);
  }

  private _getIndex(id: number): number {
    return this._translations.findIndex((t) => t.id === id);
  }

  private _insert(translation: IJEDataTranslation) {
    this._translations.push(translation);
  }

  private _createFactoryIJEDataTranslation(): IJEDataTranslation {
    return {
      id: this._currentID++,
      folder: !this._manager.isWorkspace ? this._manager.folderPath : this._filteredFolder !== "*" ? this._filteredFolder : IJEConfiguration.FOLDERS[0].path,
      valid: true,
      error: "",
      key: "",
      languages: {},
    };
  }

  private _validateImpacted(translation: IJEDataTranslation, key: string = undefined) {
    if (key === "") {
      return;
    }

    const impacted = this._validatePath(translation, false, key);

    impacted.forEach((i) => {
      if (key === undefined || (!this._comparePath(this._split(translation.key), this._split(i.key)) && this._validatePath(i, true).length === 0)) {
        i.valid = true;
        i.error = "";
        this._manager.updateTranslation(i);
      }
    });
  }

  private _validate(translation: IJEDataTranslation, keyChanged: boolean = false) {
    var t = this._validatePath(translation);
    if (translation.key === "") {
      translation.valid = false;
      translation.error = IJEDataTranslationError.KEY_NOT_EMPTY;
    } else if (keyChanged) {
      if (/^\.|\.{2,}|\.$/.test(translation.key)) {
        translation.valid = false;
        translation.error = IJEDataTranslationError.INVALID_KEY;
      } else if (this._validatePath(translation).length > 0) {
        translation.valid = false;
        translation.error = IJEDataTranslationError.DUPLICATE_PATH;
      } else {
        translation.valid = true;
        translation.error = "";
      }
    }
  }

  private _split (key: string) {
    if(IJEConfiguration.KEY_SEPARATOR) return key.split(IJEConfiguration.KEY_SEPARATOR)
    return [key]
  }

  private _validatePath(translation: IJEDataTranslation, valid: boolean = true, key: string = undefined) {
    const splitKey = this._split(key !== undefined ? key : translation.key);

    return this._translations.filter((t) => {
      if (translation.id === t.id || translation.folder !== t.folder || t.valid !== valid) {
        return false;
      }
      return this._comparePath(splitKey, this._split(t.key));
    });
  }

  private _comparePath(a: string[], b: string[]) {
    const _a = a.length >= b.length ? b : a;
    const _b = a.length < b.length ? b : a;
    return _a.every((v: string, i: number) => v === _b[i]);
  }

  private _getDisplayedTranslations(): IJEDataTranslation[] {
    var o = this._translations;
    if (this._filteredFolder !== "*") {
      o = o.filter((t) => t.folder === this._filteredFolder);
    }

    o = o
      .filter((t) => {
        let match = false;
        var regex = new RegExp(`${this._searchPattern}`, "gmi");
        match = t.key === "" || regex.test(t.key);
        if (!match) {
          this._languages.forEach((language) => {
            var content = t.languages[language] ? t.languages[language] : "";
            if (!match) {
              match = regex.test(content);
            }
          });
        }
        return match;
      })
      .sort((a, b) => {
        let _a: string, _b: string;
        if (this._view.type === IJEViewType.LIST || this._sort.column === "KEY") {
          _a = a.key.toLowerCase();
          _b = b.key.toLowerCase();
        } else if (this._sort.column === "FOLDER") {
          _a = a.folder + a.key.toLowerCase();
          _b = b.folder + b.key.toLowerCase();
        } else {
          _a = a.languages[this._sort.column] ? a.languages[this._sort.column].toLowerCase() : "";
          _b = b.languages[this._sort.column] ? b.languages[this._sort.column].toLowerCase() : "";
        }
        return ((this._view.type === IJEViewType.LIST ? true : this._sort.ascending) ? _a > _b : _a < _b) ? 1 : -1;
      });

    this._page.count = o.length;
    this._page.pageSize = this._view.type === IJEViewType.LIST ? 15 : this._page.pageSize;
    this._page.totalPages = Math.ceil(this._page.count / this._page.pageSize);

    if (this._page.pageNumber < 1) {
      this._page.pageNumber = 1;
    }

    if (this._page.pageNumber > this._page.totalPages) {
      this._page.pageNumber = this._page.totalPages;
    }

    return o.slice((this._page.pageNumber - 1) * this._page.pageSize, this._page.pageNumber * this._page.pageSize);
  }
}