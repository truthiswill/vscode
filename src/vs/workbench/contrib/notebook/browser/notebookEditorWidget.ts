/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getPixelRatio, getZoomLevel } from 'vs/base/browser/browser';
import * as DOM from 'vs/base/browser/dom';
import * as aria from 'vs/base/browser/ui/aria/aria';
import { IMouseWheelEvent, StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { IListContextMenuEvent } from 'vs/base/browser/ui/list/list';
import { IAction } from 'vs/base/common/actions';
import { SequencerByKey } from 'vs/base/common/async';
import { Color, RGBA } from 'vs/base/common/color';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { combinedDisposable, Disposable, DisposableStore, dispose, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { extname, isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import 'vs/css!./media/notebook';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo, FontInfo } from 'vs/editor/common/config/fontInfo';
import { Range } from 'vs/editor/common/core/range';
import { IEditor } from 'vs/editor/common/editorCommon';
import { IModeService } from 'vs/editor/common/services/modeService';
import * as nls from 'vs/nls';
import { createActionViewItem, createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenu, IMenuService, MenuId, MenuItemAction, MenuRegistry, SubmenuItemAction } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService, optional } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { contrastBorder, diffInserted, diffRemoved, editorBackground, errorForeground, focusBorder, foreground, listInactiveSelectionBackground, registerColor, scrollbarSliderActiveBackground, scrollbarSliderBackground, scrollbarSliderHoverBackground, textBlockQuoteBackground, textBlockQuoteBorder, textLinkActiveForeground, textLinkForeground, textPreformatForeground, transparent } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { EditorMemento } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorMemento } from 'vs/workbench/common/editor';
import { Memento, MementoObject } from 'vs/workbench/common/memento';
import { PANEL_BORDER } from 'vs/workbench/common/theme';
import { debugIconStartForeground } from 'vs/workbench/contrib/debug/browser/debugColors';
import { BOTTOM_CELL_TOOLBAR_GAP, BOTTOM_CELL_TOOLBAR_HEIGHT, CELL_BOTTOM_MARGIN, CELL_OUTPUT_PADDING, CELL_RIGHT_MARGIN, CELL_RUN_GUTTER, CELL_TOP_MARGIN, CODE_CELL_LEFT_MARGIN, COLLAPSED_INDICATOR_HEIGHT, MARKDOWN_CELL_BOTTOM_MARGIN, MARKDOWN_CELL_TOP_MARGIN, MARKDOWN_PREVIEW_PADDING, SCROLLABLE_ELEMENT_PADDING_TOP } from 'vs/workbench/contrib/notebook/browser/constants';
import { CellEditState, CellFocusMode, IActiveNotebookEditor, ICellOutputViewModel, ICellViewModel, ICommonCellInfo, IDisplayOutputLayoutUpdateRequest, IFocusNotebookCellOptions, IGenericCellViewModel, IInsetRenderOutput, INotebookCellList, INotebookCellOutputLayoutInfo, INotebookDeltaDecoration, INotebookEditor, INotebookEditorContribution, INotebookEditorContributionDescription, INotebookEditorCreationOptions, INotebookEditorMouseEvent, NotebookEditorOptions, NotebookLayoutInfo, NOTEBOOK_EDITOR_EDITABLE, NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_EDITOR_ID, NOTEBOOK_OUTPUT_FOCUSED } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookDecorationCSSRules, NotebookRefCountedStyleSheet } from 'vs/workbench/contrib/notebook/browser/notebookEditorDecorations';
import { NotebookEditorExtensionsRegistry } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { NotebookEditorKernelManager } from 'vs/workbench/contrib/notebook/browser/notebookEditorKernelManager';
import { INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/notebookEditorService';
import { NotebookCellList } from 'vs/workbench/contrib/notebook/browser/view/notebookCellList';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { BackLayerWebView, INotebookWebviewMessage } from 'vs/workbench/contrib/notebook/browser/view/renderers/backLayerWebView';
import { CellContextKeyManager } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellContextKeys';
import { CellDragAndDropController } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellDnd';
import { CodeCellRenderer, ListTopCellToolbar, MarkdownCellRenderer, NotebookCellListDelegate } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellRenderer';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { NotebookEventDispatcher, NotebookLayoutChangedEvent } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { CellViewModel, IModelDecorationsChangeAccessor, INotebookEditorViewState, NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellKind, CellToolbarLocKey, ExperimentalUseMarkdownRenderer, SelectionStateType, ShowCellStatusBarKey } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ICellRange } from 'vs/workbench/contrib/notebook/common/notebookRange';
import { editorGutterModifiedBackground } from 'vs/workbench/contrib/scm/browser/dirtydiffDecorator';
import { Webview } from 'vs/workbench/contrib/webview/browser/webview';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { CellMenus } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellMenus';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ITASExperimentService } from 'vs/workbench/services/experiment/common/experimentService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { isWeb } from 'vs/base/common/platform';
import { mark } from 'vs/workbench/contrib/notebook/common/notebookPerformance';
import { readFontInfo } from 'vs/editor/browser/config/configuration';
import { INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { NotebookEditorContextKeys } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidgetContextKeys';

const $ = DOM.$;

export class ListViewInfoAccessor extends Disposable {
	constructor(
		readonly list: INotebookCellList
	) {
		super();
	}

	revealCellRangeInView(range: ICellRange) {
		return this.list.revealElementsInView(range);
	}

	revealInView(cell: ICellViewModel) {
		this.list.revealElementInView(cell);
	}

	revealInViewAtTop(cell: ICellViewModel) {
		this.list.revealElementInViewAtTop(cell);
	}

	revealInCenterIfOutsideViewport(cell: ICellViewModel) {
		this.list.revealElementInCenterIfOutsideViewport(cell);
	}

	async revealInCenterIfOutsideViewportAsync(cell: ICellViewModel) {
		return this.list.revealElementInCenterIfOutsideViewportAsync(cell);
	}

	revealInCenter(cell: ICellViewModel) {
		this.list.revealElementInCenter(cell);
	}

	async revealLineInViewAsync(cell: ICellViewModel, line: number): Promise<void> {
		return this.list.revealElementLineInViewAsync(cell, line);
	}

	async revealLineInCenterAsync(cell: ICellViewModel, line: number): Promise<void> {
		return this.list.revealElementLineInCenterAsync(cell, line);
	}

	async revealLineInCenterIfOutsideViewportAsync(cell: ICellViewModel, line: number): Promise<void> {
		return this.list.revealElementLineInCenterIfOutsideViewportAsync(cell, line);
	}

	async revealRangeInViewAsync(cell: ICellViewModel, range: Range): Promise<void> {
		return this.list.revealElementRangeInViewAsync(cell, range);
	}

	async revealRangeInCenterAsync(cell: ICellViewModel, range: Range): Promise<void> {
		return this.list.revealElementRangeInCenterAsync(cell, range);
	}

	async revealRangeInCenterIfOutsideViewportAsync(cell: ICellViewModel, range: Range): Promise<void> {
		return this.list.revealElementRangeInCenterIfOutsideViewportAsync(cell, range);
	}

	getViewIndex(cell: ICellViewModel): number {
		return this.list.getViewIndex(cell) ?? -1;
	}

	getViewHeight(cell: ICellViewModel): number {
		if (!this.list.viewModel) {
			return -1;
		}

		return this.list.elementHeight(cell);
	}

	getCellRangeFromViewRange(startIndex: number, endIndex: number): ICellRange | undefined {
		if (!this.list.viewModel) {
			return undefined;
		}

		const modelIndex = this.list.getModelIndex2(startIndex);
		if (modelIndex === undefined) {
			throw new Error(`startIndex ${startIndex} out of boundary`);
		}

		if (endIndex >= this.list.length) {
			// it's the end
			const endModelIndex = this.list.viewModel.length;
			return { start: modelIndex, end: endModelIndex };
		} else {
			const endModelIndex = this.list.getModelIndex2(endIndex);
			if (endModelIndex === undefined) {
				throw new Error(`endIndex ${endIndex} out of boundary`);
			}
			return { start: modelIndex, end: endModelIndex };
		}
	}

	getCellsFromViewRange(startIndex: number, endIndex: number): ReadonlyArray<ICellViewModel> {
		if (!this.list.viewModel) {
			return [];
		}

		const range = this.getCellRangeFromViewRange(startIndex, endIndex);
		if (!range) {
			return [];
		}

		return this.list.viewModel.getCells(range);
	}

	setCellEditorSelection(cell: ICellViewModel, range: Range): void {
		this.list.setCellSelection(cell, range);
	}

	setHiddenAreas(_ranges: ICellRange[]): boolean {
		return this.list.setHiddenAreas(_ranges, true);
	}

	getVisibleRangesPlusViewportAboveBelow(): ICellRange[] {
		return this.list?.getVisibleRangesPlusViewportAboveBelow() ?? [];
	}

	triggerScroll(event: IMouseWheelEvent) {
		this.list.triggerScrollFromMouseWheelEvent(event);
	}
}

export class NotebookEditorWidget extends Disposable implements INotebookEditor {
	private static readonly EDITOR_MEMENTOS = new Map<string, EditorMemento<unknown>>();
	private _overlayContainer!: HTMLElement;
	private _notebookTopToolbarContainer!: HTMLElement;
	private _body!: HTMLElement;
	private _overflowContainer!: HTMLElement;
	private _webview: BackLayerWebView<ICommonCellInfo> | null = null;
	private _webviewResolvePromise: Promise<BackLayerWebView<ICommonCellInfo> | null> | null = null;
	private _webviewTransparentCover: HTMLElement | null = null;
	private _list!: INotebookCellList;
	private _listViewInfoAccessor!: ListViewInfoAccessor;
	private _dndController: CellDragAndDropController | null = null;
	private _listTopCellToolbar: ListTopCellToolbar | null = null;
	private _renderedEditors: Map<ICellViewModel, ICodeEditor | undefined> = new Map();
	private _eventDispatcher: NotebookEventDispatcher | undefined;
	private _notebookViewModel: NotebookViewModel | undefined;
	private _localStore: DisposableStore = this._register(new DisposableStore());
	private _localCellStateListeners: DisposableStore[] = [];
	private _fontInfo: FontInfo | undefined;
	private _dimension: DOM.Dimension | null = null;
	private _shadowElementViewInfo: { height: number, width: number, top: number; left: number; } | null = null;

	private readonly _editorFocus: IContextKey<boolean>;
	private readonly _outputFocus: IContextKey<boolean>;
	private readonly _editorEditable: IContextKey<boolean>;

	private _outputRenderer: OutputRenderer;
	protected readonly _contributions = new Map<string, INotebookEditorContribution>();
	private _scrollBeyondLastLine: boolean;
	private readonly _memento: Memento;
	private readonly _onDidFocusEmitter = this._register(new Emitter<void>());
	public readonly onDidFocus = this._onDidFocusEmitter.event;
	private readonly _onDidBlurEmitter = this._register(new Emitter<void>());
	public readonly onDidBlur = this._onDidBlurEmitter.event;
	private readonly _insetModifyQueueByOutputId = new SequencerByKey<string>();
	private _kernelManger: NotebookEditorKernelManager;
	private _cellContextKeyManager: CellContextKeyManager | null = null;
	private _isVisible = false;
	private readonly _uuid = generateUuid();
	private _webiewFocused: boolean = false;

	private _isDisposed: boolean = false;

	private useRenderer = false;

	get isDisposed() {
		return this._isDisposed;
	}

	private readonly _onDidChangeModel = this._register(new Emitter<NotebookTextModel | undefined>());
	readonly onDidChangeModel: Event<NotebookTextModel | undefined> = this._onDidChangeModel.event;

	private readonly _onDidFocusEditorWidget = this._register(new Emitter<void>());
	readonly onDidFocusEditorWidget = this._onDidFocusEditorWidget.event;

	set viewModel(newModel: NotebookViewModel | undefined) {
		this._notebookViewModel = newModel;
		this._onDidChangeModel.fire(newModel?.notebookDocument);
	}

	get viewModel() {
		return this._notebookViewModel;
	}

	get textModel() {
		return this._notebookViewModel?.notebookDocument;
	}

	private readonly _onDidChangeActiveEditor = this._register(new Emitter<this>());
	readonly onDidChangeActiveEditor: Event<this> = this._onDidChangeActiveEditor.event;

	get activeCodeEditor(): IEditor | undefined {
		if (this._isDisposed) {
			return;
		}

		const [focused] = this._list.getFocusedElements();
		return this._renderedEditors.get(focused);
	}

	private readonly _onDidScroll = this._register(new Emitter<void>());
	readonly onDidScroll: Event<void> = this._onDidScroll.event;
	private readonly _onDidChangeActiveCell = this._register(new Emitter<void>());
	readonly onDidChangeActiveCell: Event<void> = this._onDidChangeActiveCell.event;
	private _cursorNavigationMode: boolean = false;
	get cursorNavigationMode(): boolean {
		return this._cursorNavigationMode;
	}

	set cursorNavigationMode(v: boolean) {
		this._cursorNavigationMode = v;
	}

	private readonly _onDidChangeSelection = this._register(new Emitter<void>());
	get onDidChangeSelection(): Event<void> { return this._onDidChangeSelection.event; }

	private readonly _onDidChangeVisibleRanges = this._register(new Emitter<void>());
	onDidChangeVisibleRanges: Event<void> = this._onDidChangeVisibleRanges.event;

	get visibleRanges() {
		return this._list.visibleRanges || [];
	}

	readonly isEmbedded: boolean;

	public readonly scopedContextKeyService: IContextKeyService;
	private readonly instantiationService: IInstantiationService;

	constructor(
		readonly creationOptions: INotebookEditorCreationOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@INotebookEditorService private readonly notebookEditorService: INotebookEditorService,
		@INotebookKernelService private readonly notebookKernelService: INotebookKernelService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IMenuService private readonly menuService: IMenuService,
		@IThemeService private readonly themeService: IThemeService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IModeService private readonly modeService: IModeService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@optional(ITASExperimentService) private readonly experimentService: ITASExperimentService
	) {
		super();
		this.isEmbedded = creationOptions.isEmbedded || false;

		this.useRenderer = !isWeb && !!this.configurationService.getValue<boolean>(ExperimentalUseMarkdownRenderer) && !accessibilityService.isScreenReaderOptimized();

		this._overlayContainer = document.createElement('div');
		this.scopedContextKeyService = contextKeyService.createScoped(this._overlayContainer);
		this.instantiationService = instantiationService.createChild(new ServiceCollection([IContextKeyService, this.scopedContextKeyService]));

		this._register(this.instantiationService.createInstance(NotebookEditorContextKeys, this));

		this._kernelManger = this.instantiationService.createInstance(NotebookEditorKernelManager);
		this._register(notebookKernelService.onDidChangeNotebookKernelBinding(e => {
			if (isEqual(e.notebook, this.viewModel?.uri)) {
				this._loadKernelPreloads();
			}
		}));

		this._memento = new Memento(NOTEBOOK_EDITOR_ID, storageService);

		this._outputRenderer = new OutputRenderer(this, this.instantiationService);
		this._scrollBeyondLastLine = this.configurationService.getValue<boolean>('editor.scrollBeyondLastLine');

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.scrollBeyondLastLine')) {
				this._scrollBeyondLastLine = this.configurationService.getValue<boolean>('editor.scrollBeyondLastLine');
				if (this._dimension && this._isVisible) {
					this.layout(this._dimension);
				}
			}
			if (e.affectsConfiguration(CellToolbarLocKey) || e.affectsConfiguration(ShowCellStatusBarKey)) {
				this._updateForNotebookConfiguration();
			}
		}));

		this.notebookEditorService.addNotebookEditor(this);

		const id = generateUuid();
		this._overlayContainer.id = `notebook-${id}`;
		this._overlayContainer.className = 'notebookOverlay';
		this._overlayContainer.classList.add('notebook-editor');
		this._overlayContainer.style.visibility = 'hidden';

		this.layoutService.container.appendChild(this._overlayContainer);
		this._createBody(this._overlayContainer);
		this._generateFontInfo();
		this._isVisible = true;
		this._editorFocus = NOTEBOOK_EDITOR_FOCUSED.bindTo(this.scopedContextKeyService);
		this._outputFocus = NOTEBOOK_OUTPUT_FOCUSED.bindTo(this.scopedContextKeyService);
		this._editorEditable = NOTEBOOK_EDITOR_EDITABLE.bindTo(this.scopedContextKeyService);

		let contributions: INotebookEditorContributionDescription[];
		if (Array.isArray(this.creationOptions.contributions)) {
			contributions = this.creationOptions.contributions;
		} else {
			contributions = NotebookEditorExtensionsRegistry.getEditorContributions();
		}
		for (const desc of contributions) {
			let contribution: INotebookEditorContribution | undefined;
			try {
				contribution = this.instantiationService.createInstance(desc.ctor, this);
			} catch (err) {
				onUnexpectedError(err);
			}
			if (contribution) {
				if (!this._contributions.has(desc.id)) {
					this._contributions.set(desc.id, contribution);
				} else {
					contribution.dispose();
					throw new Error(`DUPLICATE notebook editor contribution: '${desc.id}'`);
				}
			}
		}

		this._updateForNotebookConfiguration();

		if (this._debugFlag) {
			this._domFrameLog();
		}
	}

	private _debugFlag: boolean = false;
	private _frameId = 0;
	private _domFrameLog() {
		DOM.scheduleAtNextAnimationFrame(() => {
			this._frameId++;

			this._domFrameLog();
		}, 1000000);
	}

	private _debug(...args: any[]) {
		if (!this._debugFlag) {
			return;
		}

		const date = new Date();
		console.log(`${date.getSeconds()}:${date.getMilliseconds().toString().padStart(3, '0')}`, `frame #${this._frameId}: `, ...args);
	}

	/**
	 * EditorId
	 */
	public getId(): string {
		return this._uuid;
	}

	getSelections() {
		return this.viewModel?.getSelections() ?? [];
	}

	getFocus() {
		return this.viewModel?.getFocus() ?? { start: 0, end: 0 };
	}

	getSelectionViewModels(): ICellViewModel[] {
		if (!this.viewModel) {
			return [];
		}

		const cellsSet = new Set<number>();

		return this.viewModel.getSelections().map(range => this.viewModel!.viewCells.slice(range.start, range.end)).reduce((a, b) => {
			b.forEach(cell => {
				if (!cellsSet.has(cell.handle)) {
					cellsSet.add(cell.handle);
					a.push(cell);
				}
			});

			return a;
		}, [] as ICellViewModel[]);
	}

	hasModel(): this is IActiveNotebookEditor {
		return !!this._notebookViewModel;
	}

	//#region Editor Core

	protected getEditorMemento<T>(editorGroupService: IEditorGroupsService, key: string, limit: number = 10): IEditorMemento<T> {
		const mementoKey = `${NOTEBOOK_EDITOR_ID}${key}`;

		let editorMemento = NotebookEditorWidget.EDITOR_MEMENTOS.get(mementoKey);
		if (!editorMemento) {
			editorMemento = new EditorMemento(NOTEBOOK_EDITOR_ID, key, this.getMemento(StorageScope.WORKSPACE), limit, editorGroupService);
			NotebookEditorWidget.EDITOR_MEMENTOS.set(mementoKey, editorMemento);
		}

		return editorMemento as IEditorMemento<T>;
	}

	protected getMemento(scope: StorageScope): MementoObject {
		return this._memento.getMemento(scope, StorageTarget.MACHINE);
	}

	private _updateForNotebookConfiguration() {
		if (!this._overlayContainer) {
			return;
		}

		const cellToolbarLocation = this.configurationService.getValue<string | { [key: string]: string }>(CellToolbarLocKey);
		this._overlayContainer.classList.remove('cell-title-toolbar-left');
		this._overlayContainer.classList.remove('cell-title-toolbar-right');
		this._overlayContainer.classList.remove('cell-title-toolbar-hidden');

		if (typeof cellToolbarLocation === 'string') {
			if (cellToolbarLocation === 'left' || cellToolbarLocation === 'right' || cellToolbarLocation === 'hidden') {
				this._overlayContainer.classList.add(`cell-title-toolbar-${cellToolbarLocation}`);
			}
		} else {
			if (this.viewModel) {
				const notebookSpecificSetting = cellToolbarLocation[this.viewModel.viewType] ?? cellToolbarLocation['default'];
				let cellToolbarLocationForCurrentView = 'right';

				switch (notebookSpecificSetting) {
					case 'left':
						cellToolbarLocationForCurrentView = 'left';
						break;
					case 'right':
						cellToolbarLocationForCurrentView = 'right';
					case 'hidden':
						cellToolbarLocationForCurrentView = 'hidden';
					default:
						cellToolbarLocationForCurrentView = 'right';
						break;
				}

				this._overlayContainer.classList.add(`cell-title-toolbar-${cellToolbarLocationForCurrentView}`);
			} else {
				this._overlayContainer.classList.add(`cell-title-toolbar-right`);
			}
		}

		const showCellStatusBar = this.configurationService.getValue<boolean>(ShowCellStatusBarKey);
		this._overlayContainer.classList.toggle('cell-statusbar-hidden', !showCellStatusBar);
	}

	private _generateFontInfo(): void {
		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		this._fontInfo = readFontInfo(BareFontInfo.createFromRawSettings(editorOptions, getZoomLevel(), getPixelRatio()));
	}

	private _createBody(parent: HTMLElement): void {
		this._notebookTopToolbarContainer = document.createElement('div');
		this._notebookTopToolbarContainer.classList.add('notebook-top-toolbar');
		this._notebookTopToolbarContainer.style.display = 'none';
		DOM.append(parent, this._notebookTopToolbarContainer);
		this._body = document.createElement('div');
		this._body.classList.add('cell-list-container');
		this._createCellList();
		DOM.append(parent, this._body);

		this._overflowContainer = document.createElement('div');
		this._overflowContainer.classList.add('notebook-overflow-widget-container', 'monaco-editor');
		DOM.append(parent, this._overflowContainer);
	}

	private _createCellList(): void {
		this._body.classList.add('cell-list-container');

		this._dndController = this._register(new CellDragAndDropController(this, this._body));
		const getScopedContextKeyService = (container: HTMLElement) => this._list.contextKeyService.createScoped(container);
		const renderers = [
			this.instantiationService.createInstance(CodeCellRenderer, this, this._renderedEditors, this._dndController, getScopedContextKeyService),
			this.instantiationService.createInstance(MarkdownCellRenderer, this, this._dndController, this._renderedEditors, getScopedContextKeyService, { useRenderer: this.useRenderer }),
		];

		this._list = this.instantiationService.createInstance(
			NotebookCellList,
			'NotebookCellList',
			this._overlayContainer,
			this._body,
			this.instantiationService.createInstance(NotebookCellListDelegate),
			renderers,
			this.scopedContextKeyService,
			{
				setRowLineHeight: false,
				setRowHeight: false,
				supportDynamicHeights: true,
				horizontalScrolling: false,
				keyboardSupport: false,
				mouseSupport: true,
				multipleSelectionSupport: true,
				selectionNavigation: true,
				enableKeyboardNavigation: true,
				additionalScrollHeight: 0,
				transformOptimization: false, //(isMacintosh && isNative) || getTitleBarStyle(this.configurationService, this.environmentService) === 'native',
				styleController: (_suffix: string) => { return this._list; },
				overrideStyles: {
					listBackground: editorBackground,
					listActiveSelectionBackground: editorBackground,
					listActiveSelectionForeground: foreground,
					listFocusAndSelectionBackground: editorBackground,
					listFocusAndSelectionForeground: foreground,
					listFocusBackground: editorBackground,
					listFocusForeground: foreground,
					listHoverForeground: foreground,
					listHoverBackground: editorBackground,
					listHoverOutline: focusBorder,
					listFocusOutline: focusBorder,
					listInactiveSelectionBackground: editorBackground,
					listInactiveSelectionForeground: foreground,
					listInactiveFocusBackground: editorBackground,
					listInactiveFocusOutline: editorBackground,
				},
				accessibilityProvider: {
					getAriaLabel: (element) => {
						if (!this.viewModel) {
							return '';
						}
						const index = this.viewModel.getCellIndex(element);

						if (index >= 0) {
							return `Cell ${index}, ${element.cellKind === CellKind.Markdown ? 'markdown' : 'code'}  cell`;
						}

						return '';
					},
					getWidgetAriaLabel() {
						return nls.localize('notebookTreeAriaLabel', "Notebook");
					}
				},
				focusNextPreviousDelegate: {
					onFocusNext: (applyFocusNext: () => void) => this._updateForCursorNavigationMode(applyFocusNext),
					onFocusPrevious: (applyFocusPrevious: () => void) => this._updateForCursorNavigationMode(applyFocusPrevious),
				}
			},
		);
		this._dndController.setList(this._list);

		// create Webview

		this._register(this._list);
		this._listViewInfoAccessor = new ListViewInfoAccessor(this._list);
		this._register(this._listViewInfoAccessor);

		this._register(combinedDisposable(...renderers));

		// top cell toolbar
		this._listTopCellToolbar = this._register(this.instantiationService.createInstance(ListTopCellToolbar, this, this.scopedContextKeyService, this._list.rowsContainer));

		// transparent cover
		this._webviewTransparentCover = DOM.append(this._list.rowsContainer, $('.webview-cover'));
		this._webviewTransparentCover.style.display = 'none';

		this._register(DOM.addStandardDisposableGenericMouseDownListner(this._overlayContainer, (e: StandardMouseEvent) => {
			if (e.target.classList.contains('slider') && this._webviewTransparentCover) {
				this._webviewTransparentCover.style.display = 'block';
			}
		}));

		this._register(DOM.addStandardDisposableGenericMouseUpListner(this._overlayContainer, () => {
			if (this._webviewTransparentCover) {
				// no matter when
				this._webviewTransparentCover.style.display = 'none';
			}
		}));

		this._register(this._list.onMouseDown(e => {
			if (e.element) {
				this._onMouseDown.fire({ event: e.browserEvent, target: e.element });
			}
		}));

		this._register(this._list.onMouseUp(e => {
			if (e.element) {
				this._onMouseUp.fire({ event: e.browserEvent, target: e.element });
			}
		}));

		this._register(this._list.onDidChangeFocus(_e => {
			this._onDidChangeActiveEditor.fire(this);
			this._onDidChangeActiveCell.fire();
			this._cursorNavigationMode = false;
		}));

		this._register(this._list.onContextMenu(e => {
			this.showListContextMenu(e);
		}));

		this._register(this._list.onDidChangeVisibleRanges(() => {
			this._onDidChangeVisibleRanges.fire();
		}));

		this._register(this._list.onDidScroll(() => {
			this._onDidScroll.fire();
		}));

		const widgetFocusTracker = DOM.trackFocus(this.getDomNode());
		this._register(widgetFocusTracker);
		this._register(widgetFocusTracker.onDidFocus(() => this._onDidFocusEmitter.fire()));
		this._register(widgetFocusTracker.onDidBlur(() => this._onDidBlurEmitter.fire()));

		this._reigsterNotebookActionsToolbar();
		this._register(this.editorService.onDidActiveEditorChange(() => {
			if (this.editorService.activeEditorPane?.getId() === NOTEBOOK_EDITOR_ID) {
				const notebookEditor = this.editorService.activeEditorPane.getControl() as INotebookEditor;
				if (notebookEditor === this) {
					// this is the active editor
					this._showNotebookActionsinEditorToolbar();
					return;
				}
			}

			this._editorToolbarDisposable.clear();
			this._toolbarActionDisposable.clear();
		}));
	}

	private showListContextMenu(e: IListContextMenuEvent<CellViewModel>) {
		this.contextMenuService.showContextMenu({
			getActions: () => {
				const result: IAction[] = [];
				const menu = this.menuService.createMenu(MenuId.NotebookCellTitle, this.scopedContextKeyService);
				createAndFillInContextMenuActions(menu, undefined, result);
				menu.dispose();
				return result;
			},
			getAnchor: () => e.anchor
		});
	}

	private _notebookGlobalActionsMenu!: IMenu;
	private _toolbarActionDisposable = this._register(new DisposableStore());
	private _topToolbar!: ToolBar;
	private _useGlobalToolbar: boolean = false;
	private _editorToolbarDisposable = this._register(new DisposableStore());
	private _reigsterNotebookActionsToolbar() {
		const cellMenu = this.instantiationService.createInstance(CellMenus);
		this._notebookGlobalActionsMenu = this._register(cellMenu.getNotebookToolbar(this.scopedContextKeyService));
		this._register(this._notebookGlobalActionsMenu);

		this._useGlobalToolbar = this.configurationService.getValue<boolean | undefined>('notebook.experimental.globalToolbar') ?? false;
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('notebook.experimental.globalToolbar')) {
				this._useGlobalToolbar = this.configurationService.getValue<boolean>('notebook.experimental.globalToolbar');
				this._showNotebookActionsinEditorToolbar();
			}
		}));

		this._topToolbar = new ToolBar(this._notebookTopToolbarContainer, this.contextMenuService, {
			getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id),
			actionViewItemProvider: action => {
				return createActionViewItem(this.instantiationService, action);
			},
			renderDropdownAsChildElement: true
		});
		this._register(this._topToolbar);
		this._topToolbar.context = {
			ui: true,
			notebookEditor: this
		};

		this._showNotebookActionsinEditorToolbar();
		this._register(this._notebookGlobalActionsMenu.onDidChange(() => {
			this._showNotebookActionsinEditorToolbar();
		}));

		if (this.experimentService) {
			this.experimentService.getTreatment<boolean>('nbtoolbarineditor').then(treatment => {
				if (treatment === undefined) {
					return;
				}
				if (this._useGlobalToolbar !== treatment) {
					this._useGlobalToolbar = treatment;
					this._showNotebookActionsinEditorToolbar();
				}
			});
		}
	}

	private _showNotebookActionsinEditorToolbar() {
		// when there is no view model, just ignore.
		if (!this.viewModel) {
			return;
		}

		if (!this._useGlobalToolbar) {
			// schedule actions registration in next frame, otherwise we are seeing duplicated notbebook actions temporarily
			this._editorToolbarDisposable.clear();
			this._editorToolbarDisposable.add(DOM.scheduleAtNextAnimationFrame(() => {
				const groups = this._notebookGlobalActionsMenu.getActions({ shouldForwardArgs: true });
				this._toolbarActionDisposable.clear();
				this._topToolbar.setActions([], []);
				if (!this.viewModel) {
					return;
				}

				if (!this._isVisible) {
					return;
				}

				if (this.editorService.activeEditorPane?.getId() === NOTEBOOK_EDITOR_ID) {
					const notebookEditor = this.editorService.activeEditorPane.getControl() as INotebookEditor;
					if (notebookEditor !== this) {
						// clear actions but not recreate because it is not active editor
						return;
					}
				}

				groups.forEach(group => {
					const groupName = group[0];
					const actions = group[1];

					let order = groupName === 'navigation' ? -10 : 0;
					for (let i = 0; i < actions.length; i++) {
						const menuItemAction = actions[i] as MenuItemAction;
						this._toolbarActionDisposable.add(MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
							command: {
								id: menuItemAction.item.id,
								title: menuItemAction.item.title,
								category: menuItemAction.item.category,
								tooltip: menuItemAction.item.tooltip,
								icon: menuItemAction.item.icon,
								precondition: menuItemAction.item.precondition,
								toggled: menuItemAction.item.toggled,
							},
							title: menuItemAction.item.title + ' ' + this.viewModel?.uri.scheme,
							group: groupName,
							order: order
						}));
						order++;
					}
				});
			}));

			this._notebookTopToolbarContainer.style.display = 'none';
		} else {
			this._toolbarActionDisposable.clear();
			this._topToolbar.setActions([], []);
			const groups = this._notebookGlobalActionsMenu.getActions({ shouldForwardArgs: true });
			this._notebookTopToolbarContainer.style.display = 'flex';
			const primaryGroup = groups.find(group => group[0] === 'navigation');
			const primaryActions = primaryGroup ? primaryGroup[1] : [];
			const secondaryActions = groups.filter(group => group[0] !== 'navigation').reduce((prev: (MenuItemAction | SubmenuItemAction)[], curr) => { prev.push(...curr[1]); return prev; }, []);

			this._topToolbar.setActions(primaryActions, secondaryActions);
		}

		if (this._dimension && this._isVisible) {
			this.layout(this._dimension);
		}
	}

	private _updateForCursorNavigationMode(applyFocusChange: () => void): void {
		if (this._cursorNavigationMode) {
			// Will fire onDidChangeFocus, resetting the state to Container
			applyFocusChange();

			const newFocusedCell = this._list.getFocusedElements()[0];
			if (newFocusedCell.cellKind === CellKind.Code || newFocusedCell.getEditState() === CellEditState.Editing) {
				this.focusNotebookCell(newFocusedCell, 'editor');
			} else {
				// Reset to "Editor", the state has not been consumed
				this._cursorNavigationMode = true;
			}
		} else {
			applyFocusChange();
		}
	}

	getDomNode() {
		return this._overlayContainer;
	}

	getOverflowContainerDomNode() {
		return this._overflowContainer;
	}

	getInnerWebview(): Webview | undefined {
		return this._webview?.webview;
	}

	setParentContextKeyService(parentContextKeyService: IContextKeyService): void {
		this.scopedContextKeyService.updateParent(parentContextKeyService);
	}

	async setModel(textModel: NotebookTextModel, viewState: INotebookEditorViewState | undefined): Promise<void> {
		if (this.viewModel === undefined || !this.viewModel.equal(textModel)) {
			this._detachModel();
			await this._attachModel(textModel, viewState);

			type WorkbenchNotebookOpenClassification = {
				scheme: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
				ext: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
				viewType: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
			};

			type WorkbenchNotebookOpenEvent = {
				scheme: string;
				ext: string;
				viewType: string;
			};

			this.telemetryService.publicLog2<WorkbenchNotebookOpenEvent, WorkbenchNotebookOpenClassification>('notebook/editorOpened', {
				scheme: textModel.uri.scheme,
				ext: extname(textModel.uri),
				viewType: textModel.viewType
			});
		} else {
			this.restoreListViewState(viewState);
		}

		// load preloads for matching kernel
		this._loadKernelPreloads();

		// clear state
		this._dndController?.clearGlobalDragState();

		this._localStore.add(this._list.onDidChangeFocus(() => {
			this.updateContextKeysOnFocusChange();
		}));

		this.updateContextKeysOnFocusChange();
	}

	private updateContextKeysOnFocusChange() {
		if (!this.viewModel) {
			return;
		}

		const focused = this._list.getFocusedElements()[0];
		if (focused) {
			if (!this._cellContextKeyManager) {
				this._cellContextKeyManager = this._localStore.add(new CellContextKeyManager(this.scopedContextKeyService, this, focused as CellViewModel));
			}

			this._cellContextKeyManager.updateForElement(focused as CellViewModel);
		}
	}

	async setOptions(options: NotebookEditorOptions | undefined) {
		if (!this.hasModel()) {
			return;
		}

		if (options?.isReadOnly !== undefined) {
			this.viewModel.updateOptions({ isReadOnly: options.isReadOnly });
		}

		// reveal cell if editor options tell to do so
		if (options?.cellOptions) {
			const cellOptions = options.cellOptions;
			const cell = this.viewModel.viewCells.find(cell => cell.uri.toString() === cellOptions.resource.toString());
			if (cell) {
				this.focusElement(cell);
				const selection = cellOptions.options?.selection;
				if (selection) {
					await this.revealLineInCenterIfOutsideViewportAsync(cell, selection.startLineNumber);
				} else {
					await this.revealInCenterIfOutsideViewportAsync(cell);
				}

				const editor = this._renderedEditors.get(cell)!;
				if (editor) {
					if (cellOptions.options?.selection) {
						const { selection } = cellOptions.options;
						editor.setSelection({
							...selection,
							endLineNumber: selection.endLineNumber || selection.startLineNumber,
							endColumn: selection.endColumn || selection.startColumn
						});
						editor.revealPositionInCenterIfOutsideViewport({
							lineNumber: selection.startLineNumber,
							column: selection.startColumn
						});
						await this.revealLineInCenterIfOutsideViewportAsync(cell, selection.startLineNumber);
					}
					if (!cellOptions.options?.preserveFocus) {
						editor.focus();
					}
				}
			}
		}

		// select cells if options tell to do so
		// todo@rebornix https://github.com/microsoft/vscode/issues/118108 support selections not just focus
		// todo@rebornix support multipe selections
		if (options?.cellSelections) {
			const focusCellIndex = options.cellSelections[0].start;
			const focusedCell = this.viewModel.cellAt(focusCellIndex);
			if (focusedCell) {
				this.viewModel.updateSelectionsState({
					kind: SelectionStateType.Index,
					focus: { start: focusCellIndex, end: focusCellIndex + 1 },
					selections: options.cellSelections
				});
				this.revealInCenterIfOutsideViewport(focusedCell);
			}
		}

		this._updateForOptions();
	}

	private _detachModel() {
		this._localStore.clear();
		dispose(this._localCellStateListeners);
		this._list.detachViewModel();
		this.viewModel?.dispose();
		// avoid event
		this.viewModel = undefined;
		this._webview?.dispose();
		this._webview?.element.remove();
		this._webview = null;
		this._list.clear();
	}


	private _updateForOptions(): void {
		if (!this.hasModel()) {
			return;
		}

		this._editorEditable.set(!this.viewModel.options.isReadOnly);
		this._overflowContainer.classList.toggle('notebook-editor-editable', !this.viewModel.options.isReadOnly);
		this.getDomNode().classList.toggle('notebook-editor-editable', !this.viewModel.options.isReadOnly);
	}

	private async _resolveWebview(): Promise<BackLayerWebView<ICommonCellInfo> | null> {
		if (!this.textModel) {
			return null;
		}

		if (this._webviewResolvePromise) {
			return this._webviewResolvePromise;
		}

		if (!this._webview) {
			this._createWebview(this.getId(), this.textModel.uri);
		}

		this._webviewResolvePromise = new Promise(async resolve => {
			if (!this._webview) {
				throw new Error('Notebook output webview object is not created successfully.');
			}

			await this._webview.createWebview();
			if (!this._webview.webview) {
				throw new Error('Notebook output webview elemented is not created successfully.');
			}

			this._webview.webview.onDidBlur(() => {
				this._outputFocus.set(false);
				this.updateEditorFocus();

				if (this._overlayContainer.contains(document.activeElement)) {
					this._webiewFocused = false;
				}
			});
			this._webview.webview.onDidFocus(() => {
				this._outputFocus.set(true);
				this.updateEditorFocus();
				this._onDidFocusEmitter.fire();

				if (this._overlayContainer.contains(document.activeElement)) {
					this._webiewFocused = true;
				}
			});

			this._localStore.add(this._webview.onMessage(e => {
				this._onDidReceiveMessage.fire(e);
			}));

			resolve(this._webview);
		});

		return this._webviewResolvePromise;
	}

	private async _createWebview(id: string, resource: URI): Promise<void> {
		this._webview = this.instantiationService.createInstance(BackLayerWebView, this, id, resource, {
			outputNodePadding: CELL_OUTPUT_PADDING,
			outputNodeLeftPadding: CELL_OUTPUT_PADDING,
			previewNodePadding: MARKDOWN_PREVIEW_PADDING,
			leftMargin: CODE_CELL_LEFT_MARGIN,
			rightMargin: CELL_RIGHT_MARGIN,
			runGutter: CELL_RUN_GUTTER,
		});
		this._webview.element.style.width = '100%';

		// attach the webview container to the DOM tree first
		this._list.rowsContainer.insertAdjacentElement('afterbegin', this._webview.element);
	}

	private async _attachModel(textModel: NotebookTextModel, viewState: INotebookEditorViewState | undefined) {
		await this._createWebview(this.getId(), textModel.uri);

		this._eventDispatcher = new NotebookEventDispatcher();
		this.viewModel = this.instantiationService.createInstance(NotebookViewModel, textModel.viewType, textModel, this._eventDispatcher, this.getLayoutInfo());
		this._eventDispatcher.emit([new NotebookLayoutChangedEvent({ width: true, fontInfo: true }, this.getLayoutInfo())]);

		this._updateForOptions();
		this._updateForNotebookConfiguration();

		// restore view states, including contributions

		{
			// restore view state
			this.viewModel.restoreEditorViewState(viewState);

			// contribution state restore

			const contributionsState = viewState?.contributionsState || {};
			for (const [id, contribution] of this._contributions) {
				if (typeof contribution.restoreViewState === 'function') {
					contribution.restoreViewState(contributionsState[id]);
				}
			}
		}

		this._localStore.add(this.viewModel.onDidChangeSelection(() => {
			this._onDidChangeSelection.fire();
			this.updateSelectedMarkdownPreviews();
		}));

		this._localStore.add(this._list.onWillScroll(e => {
			if (this._webview?.isResolved()) {
				this._webviewTransparentCover!.style.top = `${e.scrollTop}px`;
			}
		}));

		let hasPendingChangeContentHeight = false;
		this._localStore.add(this._list.onDidChangeContentHeight(() => {
			if (hasPendingChangeContentHeight) {
				return;
			}
			hasPendingChangeContentHeight = true;

			DOM.scheduleAtNextAnimationFrame(() => {
				hasPendingChangeContentHeight = false;
				this.updateScrollHeight();
			}, 100);
		}));

		this._localStore.add(this._list.onDidRemoveOutputs(outputs => {
			outputs.forEach(output => this.removeInset(output));
		}));
		this._localStore.add(this._list.onDidHideOutputs(outputs => {
			outputs.forEach(output => this.hideInset(output));
		}));
		this._localStore.add(this._list.onDidRemoveCellsFromView(cells => {
			const hiddenCells: MarkdownCellViewModel[] = [];
			const deletedCells: MarkdownCellViewModel[] = [];

			for (const cell of cells) {
				if (cell.cellKind === CellKind.Markdown) {
					const mdCell = cell as MarkdownCellViewModel;
					if (this.viewModel?.viewCells.find(cell => cell.handle === mdCell.handle)) {
						// Cell has been folded but is still in model
						hiddenCells.push(mdCell);
					} else {
						// Cell was deleted
						deletedCells.push(mdCell);
					}
				}
			}

			this.hideMarkdownPreviews(hiddenCells);
			this.deleteMarkdownPreviews(deletedCells);
		}));

		// init rendering
		if (this.useRenderer) {
			await this._warmupWithMarkdownRenderer(this.viewModel, viewState);
		} else {
			this._list.attachViewModel(this.viewModel);
		}

		mark(textModel.uri, 'customMarkdownLoaded');

		// model attached
		this._localCellStateListeners = this.viewModel.viewCells.map(cell => this._bindCellListener(cell));

		this._localStore.add(this.viewModel.onDidChangeViewCells((e) => {
			if (this._isDisposed) {
				return;
			}

			// update resize listener
			e.splices.reverse().forEach(splice => {
				const [start, deleted, newCells] = splice;
				const deletedCells = this._localCellStateListeners.splice(start, deleted, ...newCells.map(cell => this._bindCellListener(cell)));

				dispose(deletedCells);
			});
		}));

		if (this._dimension) {
			this._list.layout(this._dimension.height - SCROLLABLE_ELEMENT_PADDING_TOP, this._dimension.width);
		} else {
			this._list.layout();
		}

		this._dndController?.clearGlobalDragState();

		// restore list state at last, it must be after list layout
		this.restoreListViewState(viewState);
	}

	private _bindCellListener(cell: ICellViewModel) {
		const store = new DisposableStore();

		store.add(cell.onDidChangeLayout(e => {
			if (e.totalHeight !== undefined || e.outerWidth) {
				this.layoutNotebookCell(cell, cell.layoutInfo.totalHeight);
			}
		}));

		if (cell.cellKind === CellKind.Code) {
			store.add((cell as CodeCellViewModel).onDidRemoveOutputs((outputs) => {
				outputs.forEach(output => this.removeInset(output));
			}));

			store.add((cell as CodeCellViewModel).onDidHideOutputs((outputs) => {
				outputs.forEach(output => this.hideInset(output));
			}));
		}

		if (cell.cellKind === CellKind.Markdown) {
			store.add((cell as MarkdownCellViewModel).onDidHideInput(() => {
				this.hideMarkdownPreviews([(cell as MarkdownCellViewModel)]);
			}));
		}

		return store;
	}

	private async _warmupWithMarkdownRenderer(viewModel: NotebookViewModel, viewState: INotebookEditorViewState | undefined) {

		await this._resolveWebview();

		// make sure that the webview is not visible otherwise users will see pre-rendered markdown cells in wrong position as the list view doesn't have a correct `top` offset yet
		this._webview!.element.style.visibility = 'hidden';
		// warm up can take around 200ms to load markdown libraries, etc.
		await this._warmupViewport(viewModel, viewState);

		// todo@rebornix @mjbvz, is this too complicated?

		/* now the webview is ready, and requests to render markdown are fast enough
		 * we can start rendering the list view
		 * render
		 *   - markdown cell -> request to webview to (10ms, basically just latency between UI and iframe)
		 *   - code cell -> render in place
		 */
		this._list.layout(0, 0);
		this._list.attachViewModel(viewModel);

		// now the list widget has a correct contentHeight/scrollHeight
		// setting scrollTop will work properly
		// after setting scroll top, the list view will update `top` of the scrollable element, e.g. `top: -584px`
		this._list.scrollTop = viewState?.scrollPosition?.top ?? 0;
		this._debug('finish initial viewport warmup and view state restore.');
		this._webview!.element.style.visibility = 'visible';

	}

	private async _warmupViewport(viewModel: NotebookViewModel, viewState: INotebookEditorViewState | undefined) {
		if (viewState && viewState.cellTotalHeights) {
			const totalHeightCache = viewState.cellTotalHeights;
			const scrollTop = viewState.scrollPosition?.top ?? 0;
			const scrollBottom = scrollTop + Math.max(this._dimension?.height ?? 0, 1080);

			let offset = 0;
			let requests: [ICellViewModel, number][] = [];

			for (let i = 0; i < viewModel.length; i++) {
				const cell = viewModel.cellAt(i)!;

				if (offset + (totalHeightCache[i] ?? 0) < scrollTop) {
					offset += (totalHeightCache ? totalHeightCache[i] : 0);
					continue;
				} else {
					if (cell.cellKind === CellKind.Markdown) {
						requests.push([cell, offset]);
					}
				}

				offset += (totalHeightCache ? totalHeightCache[i] : 0);

				if (offset > scrollBottom) {
					break;
				}
			}

			await this._webview!.initializeMarkdown(requests
				.map(request => ({ cellId: request[0].id, cellHandle: request[0].handle, content: request[0].getText(), offset: request[1] })));
		} else {
			const initRequests = viewModel.viewCells.filter(cell => cell.cellKind === CellKind.Markdown).slice(0, 5).map(cell => ({ cellId: cell.id, cellHandle: cell.handle, content: cell.getText(), offset: -10000 }));
			await this._webview!.initializeMarkdown(initRequests);

			// no cached view state so we are rendering the first viewport
			// after above async call, we already get init height for markdown cells, we can update their offset
			let offset = 0;
			const offsetUpdateRequests: { id: string, top: number }[] = [];
			const scrollBottom = Math.max(this._dimension?.height ?? 0, 1080);
			for (const cell of viewModel.viewCells) {
				if (cell.cellKind === CellKind.Markdown) {
					offsetUpdateRequests.push({ id: cell.id, top: offset });
				}

				offset += cell.getHeight(this.getLayoutInfo().fontInfo.lineHeight);

				if (offset > scrollBottom) {
					break;
				}
			}

			this._webview?.updateScrollTops([], offsetUpdateRequests);
		}
	}

	restoreListViewState(viewState: INotebookEditorViewState | undefined): void {
		if (viewState?.scrollPosition !== undefined) {
			this._list.scrollTop = viewState!.scrollPosition.top;
			this._list.scrollLeft = viewState!.scrollPosition.left;
		} else {
			this._list.scrollTop = 0;
			this._list.scrollLeft = 0;
		}

		const focusIdx = typeof viewState?.focus === 'number' ? viewState.focus : 0;
		if (focusIdx < this._list.length) {
			const element = this._list.element(focusIdx);
			if (element) {
				this.viewModel?.updateSelectionsState({
					kind: SelectionStateType.Handle,
					primary: element.handle,
					selections: [element.handle]
				});
			}
		} else if (this._list.length > 0) {
			this.viewModel?.updateSelectionsState({
				kind: SelectionStateType.Index,
				focus: { start: 0, end: 1 },
				selections: [{ start: 0, end: 1 }]
			});
		}

		if (viewState?.editorFocused) {
			const cell = this.viewModel?.cellAt(focusIdx);
			if (cell) {
				cell.focusMode = CellFocusMode.Editor;
			}
		}
	}

	getEditorViewState(): INotebookEditorViewState {
		const state = this.viewModel?.getEditorViewState();
		if (!state) {
			return {
				editingCells: {},
				editorViewStates: {}
			};
		}

		if (this._list) {
			state.scrollPosition = { left: this._list.scrollLeft, top: this._list.scrollTop };
			const cellHeights: { [key: number]: number } = {};
			for (let i = 0; i < this.viewModel!.length; i++) {
				const elm = this.viewModel!.cellAt(i) as CellViewModel;
				if (elm.cellKind === CellKind.Code) {
					cellHeights[i] = elm.layoutInfo.totalHeight;
				} else {
					cellHeights[i] = elm.layoutInfo.totalHeight;
				}
			}

			state.cellTotalHeights = cellHeights;

			if (this.viewModel) {
				const focusRange = this.viewModel.getFocus();
				const element = this.viewModel.cellAt(focusRange.start);
				if (element) {
					const itemDOM = this._list.domElementOfElement(element);
					const editorFocused = element.getEditState() === CellEditState.Editing && !!(document.activeElement && itemDOM && itemDOM.contains(document.activeElement));

					state.editorFocused = editorFocused;
					state.focus = focusRange.start;
				}
			}
		}

		// Save contribution view states
		const contributionsState: { [key: string]: unknown } = {};
		for (const [id, contribution] of this._contributions) {
			if (typeof contribution.saveViewState === 'function') {
				contributionsState[id] = contribution.saveViewState();
			}
		}

		state.contributionsState = contributionsState;
		return state;
	}

	layout(dimension: DOM.Dimension, shadowElement?: HTMLElement): void {
		if (!shadowElement && this._shadowElementViewInfo === null) {
			this._dimension = dimension;
			return;
		}

		if (shadowElement) {
			const containerRect = shadowElement.getBoundingClientRect();

			this._shadowElementViewInfo = {
				height: containerRect.height,
				width: containerRect.width,
				top: containerRect.top,
				left: containerRect.left
			};
		}

		this._dimension = new DOM.Dimension(dimension.width, dimension.height);
		DOM.size(this._body, dimension.width, dimension.height - (this._useGlobalToolbar ? /** Toolbar height */ 26 : 0));
		if (this._list.getRenderHeight() < dimension.height - SCROLLABLE_ELEMENT_PADDING_TOP) {
			// the new dimension is larger than the list viewport, update its additional height first, otherwise the list view will move down a bit (as the `scrollBottom` will move down)
			this._list.updateOptions({ additionalScrollHeight: this._scrollBeyondLastLine ? Math.max(0, (dimension.height - SCROLLABLE_ELEMENT_PADDING_TOP - 50)) : SCROLLABLE_ELEMENT_PADDING_TOP });
			this._list.layout(dimension.height - SCROLLABLE_ELEMENT_PADDING_TOP, dimension.width);
		} else {
			// the new dimension is smaller than the list viewport, if we update the additional height, the `scrollBottom` will move up, which moves the whole list view upwards a bit. So we run a layout first.
			this._list.layout(dimension.height - SCROLLABLE_ELEMENT_PADDING_TOP, dimension.width);
			this._list.updateOptions({ additionalScrollHeight: this._scrollBeyondLastLine ? Math.max(0, (dimension.height - SCROLLABLE_ELEMENT_PADDING_TOP - 50)) : SCROLLABLE_ELEMENT_PADDING_TOP });
		}

		this._overlayContainer.style.visibility = 'visible';
		this._overlayContainer.style.display = 'block';
		this._overlayContainer.style.position = 'absolute';

		const containerRect = this._overlayContainer.parentElement?.getBoundingClientRect();
		this._overlayContainer.style.top = `${this._shadowElementViewInfo!.top - (containerRect?.top || 0)}px`;
		this._overlayContainer.style.left = `${this._shadowElementViewInfo!.left - (containerRect?.left || 0)}px`;
		this._overlayContainer.style.width = `${dimension ? dimension.width : this._shadowElementViewInfo!.width}px`;
		this._overlayContainer.style.height = `${dimension ? dimension.height : this._shadowElementViewInfo!.height}px`;

		if (this._webviewTransparentCover) {
			this._webviewTransparentCover.style.height = `${dimension.height}px`;
			this._webviewTransparentCover.style.width = `${dimension.width}px`;
		}

		this._eventDispatcher?.emit([new NotebookLayoutChangedEvent({ width: true, fontInfo: true }, this.getLayoutInfo())]);
	}
	//#endregion

	//#region Focus tracker
	focus() {
		this._isVisible = true;
		this._editorFocus.set(true);

		if (this._webiewFocused) {
			this._webview?.focusWebview();
		} else {
			if (this.viewModel) {
				const focusRange = this.viewModel.getFocus();
				const element = this.viewModel.cellAt(focusRange.start);

				if (element && element.focusMode === CellFocusMode.Editor) {
					element.updateEditState(CellEditState.Editing, 'editorWidget.focus');
					element.focusMode = CellFocusMode.Editor;
					this._onDidFocusEditorWidget.fire();
					return;
				}
			}

			this._list.domFocus();
		}

		this._onDidFocusEditorWidget.fire();
	}

	onWillHide() {
		this._isVisible = false;
		this._editorFocus.set(false);
		this._overlayContainer.style.visibility = 'hidden';
		this._overlayContainer.style.left = '-50000px';
	}

	updateEditorFocus() {
		// Note - focus going to the webview will fire 'blur', but the webview element will be
		// a descendent of the notebook editor root.
		const focused = DOM.isAncestor(document.activeElement, this._overlayContainer);
		this._editorFocus.set(focused);
		this.viewModel?.setFocus(focused);

		if (!focused) {
			this._editorToolbarDisposable.clear();
			this._toolbarActionDisposable.clear();
		}
	}

	hasFocus() {
		return this._editorFocus.get() || false;
	}

	hasWebviewFocus() {
		return this._webiewFocused;
	}

	hasOutputTextSelection() {
		if (!this.hasFocus()) {
			return false;
		}

		const windowSelection = window.getSelection();
		if (windowSelection?.rangeCount !== 1) {
			return false;
		}

		const activeSelection = windowSelection.getRangeAt(0);
		if (activeSelection.endOffset - activeSelection.startOffset === 0) {
			return false;
		}

		let container: any = activeSelection.commonAncestorContainer;

		if (!this._body.contains(container)) {
			return false;
		}

		while (container
			&&
			container !== this._body) {
			if ((container as HTMLElement).classList && (container as HTMLElement).classList.contains('output')) {
				return true;
			}

			container = container.parentNode;
		}

		return false;
	}

	//#endregion

	//#region Editor Features

	focusElement(cell: ICellViewModel) {
		this.viewModel?.updateSelectionsState({
			kind: SelectionStateType.Handle,
			primary: cell.handle,
			selections: [cell.handle]
		});
	}

	revealCellRangeInView(range: ICellRange) {
		return this._listViewInfoAccessor.revealCellRangeInView(range);
	}

	revealInView(cell: ICellViewModel) {
		this._listViewInfoAccessor.revealInView(cell);
	}

	revealInViewAtTop(cell: ICellViewModel) {
		this._listViewInfoAccessor.revealInViewAtTop(cell);
	}

	revealInCenterIfOutsideViewport(cell: ICellViewModel) {
		this._listViewInfoAccessor.revealInCenterIfOutsideViewport(cell);
	}

	async revealInCenterIfOutsideViewportAsync(cell: ICellViewModel) {
		return this._listViewInfoAccessor.revealInCenterIfOutsideViewportAsync(cell);
	}

	revealInCenter(cell: ICellViewModel) {
		this._listViewInfoAccessor.revealInCenter(cell);
	}

	async revealLineInViewAsync(cell: ICellViewModel, line: number): Promise<void> {
		return this._listViewInfoAccessor.revealLineInViewAsync(cell, line);
	}

	async revealLineInCenterAsync(cell: ICellViewModel, line: number): Promise<void> {
		return this._listViewInfoAccessor.revealLineInCenterAsync(cell, line);
	}

	async revealLineInCenterIfOutsideViewportAsync(cell: ICellViewModel, line: number): Promise<void> {
		return this._listViewInfoAccessor.revealLineInCenterIfOutsideViewportAsync(cell, line);
	}

	async revealRangeInViewAsync(cell: ICellViewModel, range: Range): Promise<void> {
		return this._listViewInfoAccessor.revealRangeInViewAsync(cell, range);
	}

	async revealRangeInCenterAsync(cell: ICellViewModel, range: Range): Promise<void> {
		return this._listViewInfoAccessor.revealRangeInCenterAsync(cell, range);
	}

	async revealRangeInCenterIfOutsideViewportAsync(cell: ICellViewModel, range: Range): Promise<void> {
		return this._listViewInfoAccessor.revealRangeInCenterIfOutsideViewportAsync(cell, range);
	}

	getViewIndex(cell: ICellViewModel): number {
		if (!this._listViewInfoAccessor) {
			return -1;
		}
		return this._listViewInfoAccessor.getViewIndex(cell);
	}

	getViewHeight(cell: ICellViewModel): number {
		if (!this._listViewInfoAccessor) {
			return -1;
		}

		return this._listViewInfoAccessor.getViewHeight(cell);
	}

	getCellRangeFromViewRange(startIndex: number, endIndex: number): ICellRange | undefined {
		return this._listViewInfoAccessor.getCellRangeFromViewRange(startIndex, endIndex);
	}

	getCellsFromViewRange(startIndex: number, endIndex: number): ReadonlyArray<ICellViewModel> {
		return this._listViewInfoAccessor.getCellsFromViewRange(startIndex, endIndex);
	}

	setCellEditorSelection(cell: ICellViewModel, range: Range): void {
		this._listViewInfoAccessor.setCellEditorSelection(cell, range);
	}

	setHiddenAreas(_ranges: ICellRange[]): boolean {
		return this._listViewInfoAccessor.setHiddenAreas(_ranges);
	}

	getVisibleRangesPlusViewportAboveBelow(): ICellRange[] {
		return this._listViewInfoAccessor.getVisibleRangesPlusViewportAboveBelow();
	}

	triggerScroll(event: IMouseWheelEvent) {
		this._listViewInfoAccessor.triggerScroll(event);
	}

	//#endregion

	//#region Decorations
	private _editorStyleSheets = new Map<string, NotebookRefCountedStyleSheet>();
	private _decorationRules = new Map<string, NotebookDecorationCSSRules>();
	private _decortionKeyToIds = new Map<string, string[]>();

	private _registerDecorationType(key: string) {
		const options = this.notebookEditorService.resolveEditorDecorationOptions(key);

		if (options) {
			const styleElement = DOM.createStyleSheet(this._body);
			const styleSheet = new NotebookRefCountedStyleSheet({
				removeEditorStyleSheets: (key) => {
					this._editorStyleSheets.delete(key);
				}
			}, key, styleElement);
			this._editorStyleSheets.set(key, styleSheet);
			this._decorationRules.set(key, new NotebookDecorationCSSRules(this.themeService, styleSheet, {
				key,
				options,
				styleSheet
			}));
		}
	}

	setEditorDecorations(key: string, range: ICellRange): void {
		if (!this.viewModel) {
			return;
		}

		// create css style for the decoration
		if (!this._editorStyleSheets.has(key)) {
			this._registerDecorationType(key);
		}

		const decorationRule = this._decorationRules.get(key);
		if (!decorationRule) {
			return;
		}

		const existingDecorations = this._decortionKeyToIds.get(key) || [];
		const newDecorations = this.viewModel.getCells(range).map(cell => ({
			handle: cell.handle,
			options: { className: decorationRule.className, outputClassName: decorationRule.className, topClassName: decorationRule.topClassName }
		}));

		this._decortionKeyToIds.set(key, this.deltaCellDecorations(existingDecorations, newDecorations));
	}

	removeEditorDecorations(key: string): void {
		if (this._decorationRules.has(key)) {
			this._decorationRules.get(key)?.dispose();
		}

		const cellDecorations = this._decortionKeyToIds.get(key);
		this.deltaCellDecorations(cellDecorations || [], []);
	}

	deltaCellDecorations(oldDecorations: string[], newDecorations: INotebookDeltaDecoration[]): string[] {
		return this.viewModel?.deltaCellDecorations(oldDecorations, newDecorations) || [];
	}

	deltaCellOutputContainerClassNames(cellId: string, added: string[], removed: string[]) {
		this._webview?.deltaCellOutputContainerClassNames(cellId, added, removed);
	}

	changeModelDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T): T | null {
		return this.viewModel?.changeModelDecorations<T>(callback) || null;
	}

	//#endregion

	//#region Mouse Events
	private readonly _onMouseUp: Emitter<INotebookEditorMouseEvent> = this._register(new Emitter<INotebookEditorMouseEvent>());
	public readonly onMouseUp: Event<INotebookEditorMouseEvent> = this._onMouseUp.event;

	private readonly _onMouseDown: Emitter<INotebookEditorMouseEvent> = this._register(new Emitter<INotebookEditorMouseEvent>());
	public readonly onMouseDown: Event<INotebookEditorMouseEvent> = this._onMouseDown.event;

	//#endregion

	//#region Kernel/Execution

	private async _loadKernelPreloads(): Promise<void> {
		if (!this.hasModel()) {
			return;
		}
		const { selected } = this.notebookKernelService.getMatchingKernel(this.viewModel.notebookDocument);
		if (!selected || !selected.preloadUris.length) {
			return;
		}
		if (!this._webview?.isResolved()) {
			await this._resolveWebview();
		}
		this._webview?.updateKernelPreloads([selected.localResourceRoot], selected.preloadUris);
	}

	get activeKernel() {
		return this.viewModel && this._kernelManger.getSelectedOrSuggestedKernel(this.viewModel.notebookDocument);
	}

	async cancelNotebookCells(cells?: Iterable<ICellViewModel>): Promise<void> {
		if (!this.hasModel()) {
			return;
		}
		if (!cells) {
			cells = this.viewModel.viewCells;
		}
		return this._kernelManger.cancelNotebookCells(this.viewModel.notebookDocument, cells);
	}

	async executeNotebookCells(cells?: Iterable<ICellViewModel>): Promise<void> {
		if (!this.hasModel()) {
			return;
		}
		if (!cells) {
			cells = this.viewModel.viewCells;
		}
		return this._kernelManger.executeNotebookCells(this.viewModel.notebookDocument, cells);
	}

	//#endregion

	//#region Cell operations/layout API
	private _pendingLayouts = new WeakMap<ICellViewModel, IDisposable>();
	async layoutNotebookCell(cell: ICellViewModel, height: number): Promise<void> {
		this._debug('layout cell', cell.handle, height);
		const viewIndex = this._list.getViewIndex(cell);
		if (viewIndex === undefined) {
			// the cell is hidden
			return;
		}

		const relayout = (cell: ICellViewModel, height: number) => {
			if (this._isDisposed) {
				return;
			}

			this._list.updateElementHeight2(cell, height);
		};

		if (this._pendingLayouts.has(cell)) {
			this._pendingLayouts.get(cell)!.dispose();
		}

		let r: () => void;
		const layoutDisposable = DOM.scheduleAtNextAnimationFrame(() => {
			if (this._isDisposed) {
				return;
			}

			if (this._list.elementHeight(cell) === height) {
				return;
			}

			this._pendingLayouts.delete(cell);

			relayout(cell, height);
			r();
		});

		this._pendingLayouts.set(cell, toDisposable(() => {
			layoutDisposable.dispose();
			r();
		}));

		return new Promise(resolve => { r = resolve; });
	}

	private _nearestCodeCellIndex(index: number /* exclusive */) {
		if (!this.viewModel) {
			return -1;
		}

		return this.viewModel.nearestCodeCellIndex(index);
	}

	insertNotebookCell(cell: ICellViewModel | undefined, type: CellKind, direction: 'above' | 'below' = 'above', initialText: string = '', ui: boolean = false): CellViewModel | null {
		if (!this.viewModel) {
			return null;
		}

		if (this.viewModel.options.isReadOnly) {
			return null;
		}

		const index = cell ? this.viewModel.getCellIndex(cell) : 0;
		const nextIndex = ui ? this.viewModel.getNextVisibleCellIndex(index) : index + 1;
		let language;
		if (type === CellKind.Code) {
			const supportedLanguages = this.activeKernel?.supportedLanguages ?? this.modeService.getRegisteredModes();
			const defaultLanguage = supportedLanguages[0] || 'plaintext';
			if (cell?.cellKind === CellKind.Code) {
				language = cell.language;
			} else if (cell?.cellKind === CellKind.Markdown) {
				const nearestCodeCellIndex = this._nearestCodeCellIndex(index);
				if (nearestCodeCellIndex > -1) {
					language = this.viewModel.cellAt(nearestCodeCellIndex)!.language;
				} else {
					language = defaultLanguage;
				}
			} else {
				if (cell === undefined && direction === 'above') {
					// insert cell at the very top
					language = this.viewModel.viewCells.find(cell => cell.cellKind === CellKind.Code)?.language || defaultLanguage;
				} else {
					language = defaultLanguage;
				}
			}

			if (!supportedLanguages.includes(language)) {
				// the language no longer exists
				language = defaultLanguage;
			}
		} else {
			language = 'markdown';
		}

		const insertIndex = cell ?
			(direction === 'above' ? index : nextIndex) :
			index;
		const focused = this._list.getFocusedElements();
		const selections = this._list.getSelectedElements();
		return this.viewModel.createCell(insertIndex, initialText, language, type, undefined, [], true, undefined, focused[0]?.handle ?? null, selections);
	}

	async splitNotebookCell(cell: ICellViewModel): Promise<CellViewModel[] | null> {
		if (!this.viewModel) {
			return null;
		}

		if (this.viewModel.options.isReadOnly) {
			return null;
		}

		const index = this.viewModel.getCellIndex(cell);

		return this.viewModel.splitNotebookCell(index);
	}

	async deleteNotebookCell(cell: ICellViewModel): Promise<boolean> {
		if (!this.viewModel) {
			return false;
		}

		if (this.viewModel.options.isReadOnly) {
			return false;
		}

		if (this._pendingLayouts.has(cell)) {
			this._pendingLayouts.get(cell)!.dispose();
		}

		const index = this.viewModel.getCellIndex(cell);
		this.viewModel.deleteCell(index, true);
		return true;
	}

	async moveCellDown(cell: ICellViewModel): Promise<ICellViewModel | null> {
		if (!this.viewModel) {
			return null;
		}

		if (this.viewModel.options.isReadOnly) {
			return null;
		}

		const index = this.viewModel.getCellIndex(cell);
		if (index === this.viewModel.length - 1) {
			return null;
		}

		const newIdx = index + 2; // This is the adjustment for the index before the cell has been "removed" from its original index
		return this._moveCellToIndex(index, 1, newIdx);
	}

	async moveCellUp(cell: ICellViewModel): Promise<ICellViewModel | null> {
		if (!this.viewModel) {
			return null;
		}

		if (this.viewModel.options.isReadOnly) {
			return null;
		}

		const index = this.viewModel.getCellIndex(cell);
		if (index === 0) {
			return null;
		}

		const newIdx = index - 1;
		return this._moveCellToIndex(index, 1, newIdx);
	}

	async moveCellsToIdx(index: number, length: number, toIdx: number): Promise<ICellViewModel | null> {
		if (!this.viewModel) {
			return null;
		}

		if (this.viewModel.options.isReadOnly) {
			return null;
		}

		return this._moveCellToIndex(index, length, toIdx);
	}

	/**
	 * @param index The current index of the cell
	 * @param desiredIndex The desired index, in an index scheme for the state of the tree before the current cell has been "removed".
	 * @example to move the cell from index 0 down one spot, call with (0, 2)
	 */
	private async _moveCellToIndex(index: number, length: number, desiredIndex: number): Promise<ICellViewModel | null> {
		if (!this.viewModel) {
			return null;
		}

		if (index < desiredIndex) {
			// The cell is moving "down", it will free up one index spot and consume a new one
			desiredIndex -= length;
		}

		if (index === desiredIndex) {
			return null;
		}

		if (!this.viewModel.moveCellToIdx(index, length, desiredIndex, true)) {
			throw new Error('Notebook Editor move cell, index out of range');
		}

		// this._list.move(index, desiredIndex);

		let r: (val: ICellViewModel | null) => void;
		DOM.scheduleAtNextAnimationFrame(() => {
			if (this._isDisposed) {
				r(null);
				return;
			}

			if (!this.viewModel) {
				r(null);
				return;
			}

			const viewCell = this.viewModel.cellAt(desiredIndex);
			if (viewCell) {
				this._list.revealElementInView(viewCell);
				r(viewCell);
			} else {
				r(null);
			}
		});

		return new Promise(resolve => { r = resolve; });
	}

	getActiveCell() {
		const elements = this._list.getFocusedElements();

		if (elements && elements.length) {
			return elements[0];
		}

		return undefined;
	}

	private _cellFocusAria(cell: ICellViewModel, focusItem: 'editor' | 'container' | 'output') {
		const index = this._notebookViewModel?.getCellIndex(cell);

		if (index !== undefined && index >= 0) {
			let position = '';
			switch (focusItem) {
				case 'editor':
					position = `the inner ${cell.cellKind === CellKind.Markdown ? 'markdown' : 'code'} editor is focused, press escape to focus the cell container`;
					break;
				case 'output':
					position = `the cell output is focused, press escape to focus the cell container`;
					break;
				case 'container':
					position = `the ${cell.cellKind === CellKind.Markdown ? 'markdown preview' : 'cell container'} is focused, press enter to focus the inner ${cell.cellKind === CellKind.Markdown ? 'markdown' : 'code'} editor`;
					break;
				default:
					break;
			}
			aria.alert(`Cell ${this._notebookViewModel?.getCellIndex(cell)}, ${position} `);
		}
	}

	toggleNotebookCellSelection(cell: ICellViewModel): void {
		const currentSelections = this._list.getSelectedElements();

		const isSelected = currentSelections.includes(cell);
		if (isSelected) {
			// Deselect
			this._list.selectElements(currentSelections.filter(current => current !== cell));
		} else {
			// Add to selection
			this._list.selectElements([...currentSelections, cell]);
		}
	}

	focusNotebookCell(cell: ICellViewModel, focusItem: 'editor' | 'container' | 'output', options?: IFocusNotebookCellOptions) {
		if (this._isDisposed) {
			return;
		}

		if (focusItem === 'editor') {
			this.focusElement(cell);
			this._cellFocusAria(cell, focusItem);
			this._list.focusView();

			cell.updateEditState(CellEditState.Editing, 'focusNotebookCell');
			cell.focusMode = CellFocusMode.Editor;
			if (!options?.skipReveal) {
				this.revealInCenterIfOutsideViewport(cell);
			}
		} else if (focusItem === 'output') {
			this.focusElement(cell);
			this._cellFocusAria(cell, focusItem);
			this._list.focusView();

			if (!this._webview) {
				return;
			}
			this._webview.focusOutput(cell.id);

			cell.updateEditState(CellEditState.Preview, 'focusNotebookCell');
			cell.focusMode = CellFocusMode.Container;
			if (!options?.skipReveal) {
				this.revealInCenterIfOutsideViewport(cell);
			}
		} else {
			const itemDOM = this._list.domElementOfElement(cell);
			if (document.activeElement && itemDOM && itemDOM.contains(document.activeElement)) {
				(document.activeElement as HTMLElement).blur();
			}

			cell.updateEditState(CellEditState.Preview, 'focusNotebookCell');
			cell.focusMode = CellFocusMode.Container;

			this.focusElement(cell);
			this._cellFocusAria(cell, focusItem);
			if (!options?.skipReveal) {
				this.revealInCenterIfOutsideViewport(cell);
			}
			this._list.focusView();
		}
	}

	focusNextNotebookCell(cell: ICellViewModel, focusItem: 'editor' | 'container' | 'output') {
		const idx = this.viewModel?.getCellIndex(cell);
		if (typeof idx !== 'number') {
			return;
		}

		const newCell = this.viewModel?.cellAt(idx + 1);
		if (!newCell) {
			return;
		}

		this.focusNotebookCell(newCell, focusItem);
	}

	//#endregion

	//#region MISC

	getLayoutInfo(): NotebookLayoutInfo {
		if (!this._list) {
			throw new Error('Editor is not initalized successfully');
		}

		return {
			width: this._dimension!.width,
			height: this._dimension!.height,
			fontInfo: this._fontInfo!
		};
	}

	getCellOutputLayoutInfo(cell: IGenericCellViewModel): INotebookCellOutputLayoutInfo {
		if (!this._list) {
			throw new Error('Editor is not initalized successfully');
		}

		return {
			width: this._dimension!.width,
			height: this._dimension!.height,
			fontInfo: this._fontInfo!
		};
	}

	async createMarkdownPreview(cell: MarkdownCellViewModel) {
		if (!this.useRenderer) {
			// TODO: handle case where custom renderer is disabled?
			return;
		}

		if (!this._webview) {
			return;
		}

		if (!this._webview.isResolved()) {
			await this._resolveWebview();
		}

		if (!this._webview) {
			return;
		}

		const cellTop = this._list.getAbsoluteTopOfElement(cell);
		await this._webview.showMarkdownPreview(cell.id, cell.handle, cell.getText(), cellTop, cell.contentHash);
	}

	async unhideMarkdownPreviews(cells: readonly MarkdownCellViewModel[]) {
		if (!this.useRenderer) {
			// TODO: handle case where custom renderer is disabled?
			return;
		}

		if (!this._webview) {
			return;
		}

		if (!this._webview.isResolved()) {
			await this._resolveWebview();
		}

		await this._webview?.unhideMarkdownPreviews(cells.map(cell => cell.id));
	}

	async hideMarkdownPreviews(cells: readonly MarkdownCellViewModel[]) {
		if (!this.useRenderer) {
			// TODO: handle case where custom renderer is disabled?
			return;
		}

		if (!this._webview || !cells.length) {
			return;
		}

		if (!this._webview.isResolved()) {
			await this._resolveWebview();
		}

		await this._webview?.hideMarkdownPreviews(cells.map(cell => cell.id));
	}

	async deleteMarkdownPreviews(cells: readonly MarkdownCellViewModel[]) {
		if (!this.useRenderer) {
			// TODO: handle case where custom renderer is disabled?
			return;
		}

		if (!this._webview) {
			return;
		}

		if (!this._webview.isResolved()) {
			await this._resolveWebview();
		}

		await this._webview?.deleteMarkdownPreviews(cells.map(cell => cell.id));
	}

	private async updateSelectedMarkdownPreviews(): Promise<void> {
		if (!this.useRenderer || !this._webview) {
			return;
		}

		if (!this._webview.isResolved()) {
			await this._resolveWebview();
		}

		const selectedCells = this.getSelectionViewModels().map(cell => cell.id);

		// Only show selection when there is more than 1 cell selected
		await this._webview?.updateMarkdownPreviewSelections(selectedCells.length > 1 ? selectedCells : []);
	}

	async createOutput(cell: CodeCellViewModel, output: IInsetRenderOutput, offset: number): Promise<void> {
		this._insetModifyQueueByOutputId.queue(output.source.model.outputId, async () => {
			if (!this._webview) {
				return;
			}

			if (!this._webview.isResolved()) {
				await this._resolveWebview();
			}

			if (!this._webview) {
				return;
			}

			const cellTop = this._list.getAbsoluteTopOfElement(cell);
			if (!this._webview.insetMapping.has(output.source)) {
				await this._webview.createOutput({ cellId: cell.id, cellHandle: cell.handle, cellUri: cell.uri }, output, cellTop, offset);
			} else {
				const outputIndex = cell.outputsViewModels.indexOf(output.source);
				const outputOffset = cell.getOutputOffset(outputIndex);
				this._webview.updateScrollTops([{
					cell,
					output: output.source,
					cellTop,
					outputOffset,
					forceDisplay: !cell.metadata.outputCollapsed,
				}], []);
			}
		});
	}

	removeInset(output: ICellOutputViewModel) {
		this._insetModifyQueueByOutputId.queue(output.model.outputId, async () => {
			if (this._webview?.isResolved()) {
				this._webview.removeInsets([output]);
			}
		});
	}

	hideInset(output: ICellOutputViewModel) {
		if (this._webview?.isResolved()) {
			this._insetModifyQueueByOutputId.queue(output.model.outputId, async () => {
				this._webview!.hideInset(output);
			});
		}
	}

	getOutputRenderer(): OutputRenderer {
		return this._outputRenderer;
	}

	//#region --- webview IPC ----

	private readonly _onDidReceiveMessage = new Emitter<INotebookWebviewMessage>();

	readonly onDidReceiveMessage: Event<INotebookWebviewMessage> = this._onDidReceiveMessage.event;

	postMessage(message: any) {
		if (this._webview?.isResolved()) {
			this._webview.postKernelMessage(message);
		}
	}

	//#endregion

	addClassName(className: string) {
		this._overlayContainer.classList.add(className);
	}

	removeClassName(className: string) {
		this._overlayContainer.classList.remove(className);
	}

	getCellByInfo(cellInfo: ICommonCellInfo): ICellViewModel {
		const { cellHandle } = cellInfo;
		return this.viewModel?.viewCells.find(vc => vc.handle === cellHandle) as CodeCellViewModel;
	}

	getCellById(cellId: string): ICellViewModel | undefined {
		return this.viewModel?.viewCells.find(vc => vc.id === cellId);
	}

	updateOutputHeight(cellInfo: ICommonCellInfo, output: ICellOutputViewModel, outputHeight: number, isInit: boolean, source?: string): void {
		const cell = this.viewModel?.viewCells.find(vc => vc.handle === cellInfo.cellHandle);
		if (cell && cell instanceof CodeCellViewModel) {
			const outputIndex = cell.outputsViewModels.indexOf(output);
			if (isInit && outputHeight !== 0) {
				cell.updateOutputMinHeight(0);
			}
			this._debug('update cell output', cell.handle, outputHeight);
			cell.updateOutputHeight(outputIndex, outputHeight, source);
			this.layoutNotebookCell(cell, cell.layoutInfo.totalHeight);
		}
	}

	updateScrollHeight() {
		if (this._isDisposed || !this._webview?.isResolved()) {
			return;
		}

		const scrollHeight = this._list.scrollHeight;
		this._webview!.element.style.height = `${scrollHeight}px`;

		const updateItems: IDisplayOutputLayoutUpdateRequest[] = [];
		const removedItems: ICellOutputViewModel[] = [];
		this._webview?.insetMapping.forEach((value, key) => {
			const cell = this.viewModel?.getCellByHandle(value.cellInfo.cellHandle);
			if (!cell || !(cell instanceof CodeCellViewModel)) {
				return;
			}

			this.viewModel?.viewCells.find(cell => cell.handle === value.cellInfo.cellHandle);
			const viewIndex = this._list.getViewIndex(cell);

			if (viewIndex === undefined) {
				return;
			}

			if (cell.outputsViewModels.indexOf(key) < 0) {
				// output is already gone
				removedItems.push(key);
			}

			const cellTop = this._list.getAbsoluteTopOfElement(cell);
			const outputIndex = cell.outputsViewModels.indexOf(key);
			const outputOffset = cell.getOutputOffset(outputIndex);
			updateItems.push({
				cell,
				output: key,
				cellTop,
				outputOffset,
				forceDisplay: false,
			});
		});

		this._webview.removeInsets(removedItems);

		const markdownUpdateItems: { id: string, top: number }[] = [];
		for (const cellId of this._webview.markdownPreviewMapping.keys()) {
			const cell = this.viewModel?.viewCells.find(cell => cell.id === cellId);
			if (cell) {
				const cellTop = this._list.getAbsoluteTopOfElement(cell);
				markdownUpdateItems.push({ id: cellId, top: cellTop });
			}
		}

		if (markdownUpdateItems.length || updateItems.length) {
			this._debug('_list.onDidChangeContentHeight/markdown', markdownUpdateItems);
			this._webview?.updateScrollTops(updateItems, markdownUpdateItems);
		}
	}

	scheduleOutputHeightAck(cellInfo: ICommonCellInfo, outputId: string, height: number) {
		DOM.scheduleAtNextAnimationFrame(() => {
			this.updateScrollHeight();

			this._debug('ack height', height);
			this._webview?.ackHeight(cellInfo.cellId, outputId, height);
		}, 10);
	}

	updateMarkdownCellHeight(cellId: string, height: number, isInit: boolean) {
		const cell = this.getCellById(cellId);
		if (cell && cell instanceof MarkdownCellViewModel) {
			if (height + BOTTOM_CELL_TOOLBAR_GAP !== cell.layoutInfo.totalHeight) {
				this._debug('updateMarkdownCellHeight', cell.handle, height + BOTTOM_CELL_TOOLBAR_GAP, isInit);
				cell.renderedMarkdownHeight = height;
			}
		}
	}

	setMarkdownCellEditState(cellId: string, editState: CellEditState): void {
		const cell = this.getCellById(cellId);
		if (cell instanceof MarkdownCellViewModel) {
			cell.updateEditState(editState, 'setMarkdownCellEditState');
		}
	}

	markdownCellDragStart(cellId: string, ctx: { clientY: number }): void {
		const cell = this.getCellById(cellId);
		if (cell instanceof MarkdownCellViewModel) {
			this._dndController?.startExplicitDrag(cell, ctx);
		}
	}

	markdownCellDrag(cellId: string, ctx: { clientY: number }): void {
		const cell = this.getCellById(cellId);
		if (cell instanceof MarkdownCellViewModel) {
			this._dndController?.explicitDrag(cell, ctx);
		}
	}

	markdownCellDrop(cellId: string, ctx: { clientY: number, ctrlKey: boolean, altKey: boolean }): void {
		const cell = this.getCellById(cellId);
		if (cell instanceof MarkdownCellViewModel) {
			this._dndController?.explicitDrop(cell, ctx);
		}
	}

	markdownCellDragEnd(cellId: string): void {
		const cell = this.getCellById(cellId);
		if (cell instanceof MarkdownCellViewModel) {
			this._dndController?.endExplicitDrag(cell);
		}
	}

	//#endregion

	//#region Editor Contributions
	getContribution<T extends INotebookEditorContribution>(id: string): T {
		return <T>(this._contributions.get(id) || null);
	}

	//#endregion

	override dispose() {
		this._isDisposed = true;
		// dispose webview first
		this._webview?.dispose();
		this._webview = null;

		this.notebookEditorService.removeNotebookEditor(this);
		dispose(this._contributions.values());
		this._contributions.clear();

		this._localStore.clear();
		dispose(this._localCellStateListeners);
		this._list.dispose();
		this._listTopCellToolbar?.dispose();

		this._overlayContainer.remove();
		this.viewModel?.dispose();
		super.dispose();
	}

	toJSON(): { notebookUri: URI | undefined } {
		return {
			notebookUri: this.viewModel?.uri,
		};
	}
}

export const notebookCellBorder = registerColor('notebook.cellBorderColor', {
	dark: transparent(listInactiveSelectionBackground, 1),
	light: transparent(listInactiveSelectionBackground, 1),
	hc: PANEL_BORDER
}, nls.localize('notebook.cellBorderColor', "The border color for notebook cells."));

export const focusedEditorBorderColor = registerColor('notebook.focusedEditorBorder', {
	light: focusBorder,
	dark: focusBorder,
	hc: focusBorder
}, nls.localize('notebook.focusedEditorBorder', "The color of the notebook cell editor border."));

export const cellStatusIconSuccess = registerColor('notebookStatusSuccessIcon.foreground', {
	light: debugIconStartForeground,
	dark: debugIconStartForeground,
	hc: debugIconStartForeground
}, nls.localize('notebookStatusSuccessIcon.foreground', "The error icon color of notebook cells in the cell status bar."));

export const cellStatusIconError = registerColor('notebookStatusErrorIcon.foreground', {
	light: errorForeground,
	dark: errorForeground,
	hc: errorForeground
}, nls.localize('notebookStatusErrorIcon.foreground', "The error icon color of notebook cells in the cell status bar."));

export const cellStatusIconRunning = registerColor('notebookStatusRunningIcon.foreground', {
	light: foreground,
	dark: foreground,
	hc: foreground
}, nls.localize('notebookStatusRunningIcon.foreground', "The running icon color of notebook cells in the cell status bar."));

export const notebookOutputContainerColor = registerColor('notebook.outputContainerBackgroundColor', {
	dark: notebookCellBorder,
	light: notebookCellBorder,
	hc: null
}, nls.localize('notebook.outputContainerBackgroundColor', "The Color of the notebook output container background."));

// TODO@rebornix currently also used for toolbar border, if we keep all of this, pick a generic name
export const CELL_TOOLBAR_SEPERATOR = registerColor('notebook.cellToolbarSeparator', {
	dark: Color.fromHex('#808080').transparent(0.35),
	light: Color.fromHex('#808080').transparent(0.35),
	hc: contrastBorder
}, nls.localize('notebook.cellToolbarSeparator', "The color of the separator in the cell bottom toolbar"));

export const focusedCellBackground = registerColor('notebook.focusedCellBackground', {
	dark: null,
	light: null,
	hc: null
}, nls.localize('focusedCellBackground', "The background color of a cell when the cell is focused."));

export const selectedCellBackground = registerColor('notebook.selectedCellBackground', {
	dark: listInactiveSelectionBackground,
	light: listInactiveSelectionBackground,
	hc: null
}, nls.localize('selectedCellBackground', "The background color of a cell when the cell is selected."));


export const cellHoverBackground = registerColor('notebook.cellHoverBackground', {
	dark: transparent(focusedCellBackground, .5),
	light: transparent(focusedCellBackground, .7),
	hc: null
}, nls.localize('notebook.cellHoverBackground', "The background color of a cell when the cell is hovered."));

export const selectedCellBorder = registerColor('notebook.selectedCellBorder', {
	dark: notebookCellBorder,
	light: notebookCellBorder,
	hc: contrastBorder
}, nls.localize('notebook.selectedCellBorder', "The color of the cell's top and bottom border when the cell is selected but not focused."));

export const inactiveSelectedCellBorder = registerColor('notebook.inactiveSelectedCellBorder', {
	dark: null,
	light: null,
	hc: focusBorder
}, nls.localize('notebook.inactiveSelectedCellBorder', "The color of the cell's borders when multiple cells are selected."));

export const focusedCellBorder = registerColor('notebook.focusedCellBorder', {
	dark: focusBorder,
	light: focusBorder,
	hc: focusBorder
}, nls.localize('notebook.focusedCellBorder', "The color of the cell's borders when the cell is focused."));

export const inactiveFocusedCellBorder = registerColor('notebook.inactiveFocusedCellBorder', {
	dark: notebookCellBorder,
	light: notebookCellBorder,
	hc: notebookCellBorder
}, nls.localize('notebook.inactiveFocusedCellBorder', "The color of the cell's top and bottom border when a cell is focused while the primary focus is outside of the editor."));

export const cellStatusBarItemHover = registerColor('notebook.cellStatusBarItemHoverBackground', {
	light: new Color(new RGBA(0, 0, 0, 0.08)),
	dark: new Color(new RGBA(255, 255, 255, 0.15)),
	hc: new Color(new RGBA(255, 255, 255, 0.15)),
}, nls.localize('notebook.cellStatusBarItemHoverBackground', "The background color of notebook cell status bar items."));

export const cellInsertionIndicator = registerColor('notebook.cellInsertionIndicator', {
	light: focusBorder,
	dark: focusBorder,
	hc: focusBorder
}, nls.localize('notebook.cellInsertionIndicator', "The color of the notebook cell insertion indicator."));

export const listScrollbarSliderBackground = registerColor('notebookScrollbarSlider.background', {
	dark: scrollbarSliderBackground,
	light: scrollbarSliderBackground,
	hc: scrollbarSliderBackground
}, nls.localize('notebookScrollbarSliderBackground', "Notebook scrollbar slider background color."));

export const listScrollbarSliderHoverBackground = registerColor('notebookScrollbarSlider.hoverBackground', {
	dark: scrollbarSliderHoverBackground,
	light: scrollbarSliderHoverBackground,
	hc: scrollbarSliderHoverBackground
}, nls.localize('notebookScrollbarSliderHoverBackground', "Notebook scrollbar slider background color when hovering."));

export const listScrollbarSliderActiveBackground = registerColor('notebookScrollbarSlider.activeBackground', {
	dark: scrollbarSliderActiveBackground,
	light: scrollbarSliderActiveBackground,
	hc: scrollbarSliderActiveBackground
}, nls.localize('notebookScrollbarSliderActiveBackground', "Notebook scrollbar slider background color when clicked on."));

export const cellSymbolHighlight = registerColor('notebook.symbolHighlightBackground', {
	dark: Color.fromHex('#ffffff0b'),
	light: Color.fromHex('#fdff0033'),
	hc: null
}, nls.localize('notebook.symbolHighlightBackground', "Background color of highlighted cell"));

registerThemingParticipant((theme, collector) => {
	collector.addRule(`.notebookOverlay > .cell-list-container > .monaco-list > .monaco-scrollable-element,
	.notebookOverlay > .cell-list-container > .notebook-gutter > .monaco-list > .monaco-scrollable-element {
		padding-top: ${SCROLLABLE_ELEMENT_PADDING_TOP}px;
		box-sizing: border-box;
	}`);

	const link = theme.getColor(textLinkForeground);
	if (link) {
		collector.addRule(`.notebookOverlay .output a,
			.notebookOverlay .cell.markdown a,
			.notebookOverlay .output-show-more-container a
			{ color: ${link};} `);

	}
	const activeLink = theme.getColor(textLinkActiveForeground);
	if (activeLink) {
		collector.addRule(`.notebookOverlay .output a:hover,
			.notebookOverlay .cell .output a:active,
			.notebookOverlay .output-show-more-container a:active
			{ color: ${activeLink}; }`);
	}
	const shortcut = theme.getColor(textPreformatForeground);
	if (shortcut) {
		collector.addRule(`.notebookOverlay code,
			.notebookOverlay .shortcut { color: ${shortcut}; }`);
	}
	const border = theme.getColor(contrastBorder);
	if (border) {
		collector.addRule(`.notebookOverlay .monaco-editor { border-color: ${border}; }`);
	}
	const quoteBackground = theme.getColor(textBlockQuoteBackground);
	if (quoteBackground) {
		collector.addRule(`.notebookOverlay blockquote { background: ${quoteBackground}; }`);
	}
	const quoteBorder = theme.getColor(textBlockQuoteBorder);
	if (quoteBorder) {
		collector.addRule(`.notebookOverlay blockquote { border-color: ${quoteBorder}; }`);
	}

	const containerBackground = theme.getColor(notebookOutputContainerColor);
	if (containerBackground) {
		collector.addRule(`.notebookOverlay .output { background-color: ${containerBackground}; }`);
		collector.addRule(`.notebookOverlay .output-element { background-color: ${containerBackground}; }`);
		collector.addRule(`.notebookOverlay .output-show-more-container { background-color: ${containerBackground}; }`);
	}

	const editorBackgroundColor = theme.getColor(editorBackground);
	if (editorBackgroundColor) {
		collector.addRule(`.notebookOverlay .cell .monaco-editor-background,
			.notebookOverlay .cell .margin-view-overlays,
			.notebookOverlay .cell .cell-statusbar-container { background: ${editorBackgroundColor}; }`);
		collector.addRule(`.notebookOverlay .cell-drag-image .cell-editor-container > div { background: ${editorBackgroundColor} !important; }`);

		collector.addRule(`.notebookOverlay .monaco-list-row .cell-title-toolbar { background-color: ${editorBackgroundColor}; }`);
		collector.addRule(`.notebookOverlay .monaco-list-row.cell-drag-image { background-color: ${editorBackgroundColor}; }`);
		collector.addRule(`.notebookOverlay .cell-bottom-toolbar-container .action-item { background-color: ${editorBackgroundColor} }`);
		collector.addRule(`.notebookOverlay .cell-list-top-cell-toolbar-container .action-item { background-color: ${editorBackgroundColor} }`);
	}

	const cellToolbarSeperator = theme.getColor(CELL_TOOLBAR_SEPERATOR);
	if (cellToolbarSeperator) {
		collector.addRule(`.notebookOverlay .monaco-list-row .cell-title-toolbar { border: solid 1px ${cellToolbarSeperator}; }`);
		collector.addRule(`.notebookOverlay .cell-bottom-toolbar-container .action-item { border: solid 1px ${cellToolbarSeperator} }`);
		collector.addRule(`.notebookOverlay .cell-list-top-cell-toolbar-container .action-item { border: solid 1px ${cellToolbarSeperator} }`);
		collector.addRule(`.monaco-workbench .notebookOverlay > .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row .cell-collapsed-part { border-bottom: solid 1px ${cellToolbarSeperator} }`);
		collector.addRule(`.notebookOverlay .monaco-action-bar .action-item.verticalSeparator { background-color: ${cellToolbarSeperator} }`);
	}

	const focusedCellBackgroundColor = theme.getColor(focusedCellBackground);
	if (focusedCellBackgroundColor) {
		collector.addRule(`.notebookOverlay .code-cell-row.focused .cell-focus-indicator,
			.notebookOverlay .markdown-cell-row.focused { background-color: ${focusedCellBackgroundColor} !important; }`);
		collector.addRule(`.notebookOverlay .code-cell-row.focused .cell-collapsed-part { background-color: ${focusedCellBackgroundColor} !important; }`);
	}

	const selectedCellBackgroundColor = theme.getColor(selectedCellBackground);
	if (selectedCellBackground) {
		collector.addRule(`.notebookOverlay .monaco-list.selection-multiple .markdown-cell-row.selected { background-color: ${selectedCellBackgroundColor} !important; }`);
		collector.addRule(`.notebookOverlay .monaco-list.selection-multiple .code-cell-row.selected .cell-focus-indicator-top { background-color: ${selectedCellBackgroundColor} !important; }`);
		collector.addRule(`.notebookOverlay .monaco-list.selection-multiple .code-cell-row.selected .cell-focus-indicator-left { background-color: ${selectedCellBackgroundColor} !important; }`);
		collector.addRule(`.notebookOverlay .monaco-list.selection-multiple .code-cell-row.selected .cell-focus-indicator-right { background-color: ${selectedCellBackgroundColor} !important; }`);
		collector.addRule(`.notebookOverlay .monaco-list.selection-multiple .code-cell-row.selected .cell-focus-indicator-bottom { background-color: ${selectedCellBackgroundColor} !important; }`);
	}

	const inactiveSelectedCellBorderColor = theme.getColor(inactiveSelectedCellBorder);
	collector.addRule(`
			.notebookOverlay .monaco-list.selection-multiple:focus-within .monaco-list-row.selected .cell-focus-indicator-top:before,
			.notebookOverlay .monaco-list.selection-multiple:focus-within .monaco-list-row.selected .cell-focus-indicator-bottom:before,
			.notebookOverlay .monaco-list.selection-multiple:focus-within .monaco-list-row.selected .cell-inner-container:not(.cell-editor-focus) .cell-focus-indicator-left:before,
			.notebookOverlay .monaco-list.selection-multiple:focus-within .monaco-list-row.selected .cell-inner-container:not(.cell-editor-focus) .cell-focus-indicator-right:before {
					border-color: ${inactiveSelectedCellBorderColor} !important;
			}
	`);

	const cellHoverBackgroundColor = theme.getColor(cellHoverBackground);
	if (cellHoverBackgroundColor) {
		collector.addRule(`.notebookOverlay .code-cell-row:not(.focused):hover .cell-focus-indicator,
			.notebookOverlay .code-cell-row:not(.focused).cell-output-hover .cell-focus-indicator,
			.notebookOverlay .markdown-cell-row:not(.focused):hover { background-color: ${cellHoverBackgroundColor} !important; }`);
		collector.addRule(`.notebookOverlay .code-cell-row:not(.focused):hover .cell-collapsed-part,
			.notebookOverlay .code-cell-row:not(.focused).cell-output-hover .cell-collapsed-part { background-color: ${cellHoverBackgroundColor}; }`);
	}

	const focusedCellBorderColor = theme.getColor(focusedCellBorder);
	collector.addRule(`
			.monaco-workbench .notebookOverlay .monaco-list:focus-within .monaco-list-row.focused .cell-focus-indicator-top:before,
			.monaco-workbench .notebookOverlay .monaco-list:focus-within .monaco-list-row.focused .cell-focus-indicator-bottom:before,
			.monaco-workbench .notebookOverlay .monaco-list:focus-within .monaco-list-row.focused .cell-inner-container:not(.cell-editor-focus) .cell-focus-indicator-left:before,
			.monaco-workbench .notebookOverlay .monaco-list:focus-within .monaco-list-row.focused .cell-inner-container:not(.cell-editor-focus) .cell-focus-indicator-right:before {
				border-color: ${focusedCellBorderColor} !important;
			}`);

	const inactiveFocusedBorderColor = theme.getColor(inactiveFocusedCellBorder);
	collector.addRule(`
			.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.focused .cell-focus-indicator-top:before,
			.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.focused .cell-focus-indicator-bottom:before {
				border-color: ${inactiveFocusedBorderColor} !important;
			}`);

	const selectedCellBorderColor = theme.getColor(selectedCellBorder);
	collector.addRule(`
			.monaco-workbench .notebookOverlay .monaco-list:focus-within .monaco-list-row.focused .cell-editor-focus .cell-focus-indicator-top:before,
			.monaco-workbench .notebookOverlay .monaco-list:focus-within .monaco-list-row.focused .cell-editor-focus .cell-focus-indicator-bottom:before,
			.monaco-workbench .notebookOverlay .monaco-list:focus-within .monaco-list-row.focused .cell-inner-container.cell-editor-focus:before {
				border-color: ${selectedCellBorderColor} !important;
			}`);

	const cellSymbolHighlightColor = theme.getColor(cellSymbolHighlight);
	if (cellSymbolHighlightColor) {
		collector.addRule(`.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.code-cell-row.nb-symbolHighlight .cell-focus-indicator,
		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.markdown-cell-row.nb-symbolHighlight {
			background-color: ${cellSymbolHighlightColor} !important;
		}`);
	}

	const focusedEditorBorderColorColor = theme.getColor(focusedEditorBorderColor);
	if (focusedEditorBorderColorColor) {
		collector.addRule(`.notebookOverlay .monaco-list-row .cell-editor-focus .cell-editor-part:before { outline: solid 1px ${focusedEditorBorderColorColor}; }`);
	}

	const cellBorderColor = theme.getColor(notebookCellBorder);
	if (cellBorderColor) {
		collector.addRule(`.notebookOverlay .cell.markdown h1 { border-color: ${cellBorderColor}; }`);
		collector.addRule(`.notebookOverlay .monaco-list-row .cell-editor-part:before { outline: solid 1px ${cellBorderColor}; }`);
	}

	const cellStatusBarHoverBg = theme.getColor(cellStatusBarItemHover);
	if (cellStatusBarHoverBg) {
		collector.addRule(`.monaco-workbench .notebookOverlay .cell-statusbar-container .cell-language-picker:hover,
		.monaco-workbench .notebookOverlay .cell-statusbar-container .cell-status-item.cell-status-item-has-command:hover { background-color: ${cellStatusBarHoverBg}; }`);
	}

	const cellInsertionIndicatorColor = theme.getColor(cellInsertionIndicator);
	if (cellInsertionIndicatorColor) {
		collector.addRule(`.notebookOverlay > .cell-list-container > .cell-list-insertion-indicator { background-color: ${cellInsertionIndicatorColor}; }`);
	}

	const scrollbarSliderBackgroundColor = theme.getColor(listScrollbarSliderBackground);
	if (scrollbarSliderBackgroundColor) {
		collector.addRule(` .notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .scrollbar > .slider { background: ${scrollbarSliderBackgroundColor}; } `);
		// collector.addRule(` .monaco-workbench .notebookOverlay .output-plaintext::-webkit-scrollbar-track { background: ${scrollbarSliderBackgroundColor}; } `);
	}

	const scrollbarSliderHoverBackgroundColor = theme.getColor(listScrollbarSliderHoverBackground);
	if (scrollbarSliderHoverBackgroundColor) {
		collector.addRule(` .notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .scrollbar > .slider:hover { background: ${scrollbarSliderHoverBackgroundColor}; } `);
		collector.addRule(` .monaco-workbench .notebookOverlay .output-plaintext::-webkit-scrollbar-thumb { background: ${scrollbarSliderHoverBackgroundColor}; } `);
		collector.addRule(` .monaco-workbench .notebookOverlay .output .error::-webkit-scrollbar-thumb { background: ${scrollbarSliderHoverBackgroundColor}; } `);
	}

	const scrollbarSliderActiveBackgroundColor = theme.getColor(listScrollbarSliderActiveBackground);
	if (scrollbarSliderActiveBackgroundColor) {
		collector.addRule(` .notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .scrollbar > .slider.active { background: ${scrollbarSliderActiveBackgroundColor}; } `);
	}

	// case ChangeType.Modify: return theme.getColor(editorGutterModifiedBackground);
	// case ChangeType.Add: return theme.getColor(editorGutterAddedBackground);
	// case ChangeType.Delete: return theme.getColor(editorGutterDeletedBackground);
	// diff

	const modifiedBackground = theme.getColor(editorGutterModifiedBackground);
	if (modifiedBackground) {
		collector.addRule(`
		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.code-cell-row.nb-cell-modified .cell-focus-indicator {
			background-color: ${modifiedBackground} !important;
		}

		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.markdown-cell-row.nb-cell-modified {
			background-color: ${modifiedBackground} !important;
		}`);
	}

	const addedBackground = theme.getColor(diffInserted);
	if (addedBackground) {
		collector.addRule(`
		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.code-cell-row.nb-cell-added .cell-focus-indicator {
			background-color: ${addedBackground} !important;
		}

		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.markdown-cell-row.nb-cell-added {
			background-color: ${addedBackground} !important;
		}`);
	}
	const deletedBackground = theme.getColor(diffRemoved);
	if (deletedBackground) {
		collector.addRule(`
		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.code-cell-row.nb-cell-deleted .cell-focus-indicator {
			background-color: ${deletedBackground} !important;
		}

		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.markdown-cell-row.nb-cell-deleted {
			background-color: ${deletedBackground} !important;
		}`);
	}

	// Cell Margin
	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .markdown-cell-row div.cell.code { margin-left: ${CODE_CELL_LEFT_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .code-cell-row div.cell.code { margin-left: ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER}px; }`);
	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row div.cell { margin-right: ${CELL_RIGHT_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row > .cell-inner-container { padding-top: ${CELL_TOP_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .markdown-cell-row > .cell-inner-container { padding-bottom: ${MARKDOWN_CELL_BOTTOM_MARGIN}px; padding-top: ${MARKDOWN_CELL_TOP_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .markdown-cell-row > .cell-inner-container.webview-backed-markdown-cell { padding: 0; }`);
	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .markdown-cell-row > .webview-backed-markdown-cell.markdown-cell-edit-mode .cell.code { padding-bottom: ${MARKDOWN_CELL_BOTTOM_MARGIN}px; padding-top: ${MARKDOWN_CELL_TOP_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .output { margin: 0px ${CELL_RIGHT_MARGIN}px 0px ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER}px; }`);
	collector.addRule(`.notebookOverlay .output { width: calc(100% - ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER + CELL_RIGHT_MARGIN}px); }`);

	collector.addRule(`.notebookOverlay .output-show-more-container { margin: 0px ${CELL_RIGHT_MARGIN}px 0px ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER}px; }`);
	collector.addRule(`.notebookOverlay .output-show-more-container { width: calc(100% - ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER + CELL_RIGHT_MARGIN}px); }`);

	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row div.cell.markdown { padding-left: ${CELL_RUN_GUTTER}px; }`);
	collector.addRule(`.notebookOverlay .cell .run-button-container { width: 20px; left: ${CODE_CELL_LEFT_MARGIN + Math.floor(CELL_RUN_GUTTER - 20) / 2}px }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row :not(.webview-backed-markdown-cell) .cell-focus-indicator-top { height: ${CELL_TOP_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row .cell-focus-indicator-side { bottom: ${BOTTOM_CELL_TOOLBAR_GAP}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row.code-cell-row .cell-focus-indicator-left,
	.notebookOverlay .monaco-list .monaco-list-row.code-cell-row .cell-drag-handle { width: ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row.markdown-cell-row .cell-focus-indicator-left { width: ${CODE_CELL_LEFT_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row .cell-focus-indicator.cell-focus-indicator-right { width: ${CELL_RIGHT_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row .cell-focus-indicator-bottom { height: ${CELL_BOTTOM_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row .cell-shadow-container-bottom { top: ${CELL_BOTTOM_MARGIN}px; }`);

	collector.addRule(`.monaco-workbench .notebookOverlay > .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row .cell-collapsed-part { margin-left: ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER}px; height: ${COLLAPSED_INDICATOR_HEIGHT}px; }`);
	collector.addRule(`.notebookOverlay .cell-list-top-cell-toolbar-container { top: -${SCROLLABLE_ELEMENT_PADDING_TOP}px }`);

	collector.addRule(`.monaco-workbench .notebookOverlay > .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row .cell-bottom-toolbar-container { height: ${BOTTOM_CELL_TOOLBAR_HEIGHT}px }`);
	collector.addRule(`.monaco-workbench .notebookOverlay > .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .cell-list-top-cell-toolbar-container { height: ${BOTTOM_CELL_TOOLBAR_HEIGHT}px }`);

	// left and right border margins
	collector.addRule(`
			.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.code-cell-row.focused .cell-focus-indicator-left:before,
			.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.code-cell-row.focused .cell-focus-indicator-right:before,
			.monaco-workbench .notebookOverlay .monaco-list.selection-multiple .monaco-list-row.code-cell-row.selected .cell-focus-indicator-left:before,
			.monaco-workbench .notebookOverlay .monaco-list.selection-multiple .monaco-list-row.code-cell-row.selected .cell-focus-indicator-right:before {
				top: -${CELL_TOP_MARGIN}px; height: calc(100% + ${CELL_TOP_MARGIN + CELL_BOTTOM_MARGIN}px)
			}`);
});
