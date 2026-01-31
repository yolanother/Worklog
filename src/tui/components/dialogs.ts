import blessed from 'blessed';
import type { BlessedBox, BlessedFactory, BlessedList, BlessedScreen } from '../types.js';
import type { OverlaysComponent } from './overlays.js';

export interface DialogsComponentOptions {
  parent: BlessedScreen;
  blessed?: BlessedFactory;
  overlays: OverlaysComponent;
}

export class DialogsComponent {
  private blessedImpl: BlessedFactory;
  private screen: BlessedScreen;
  private overlays: OverlaysComponent;

  readonly detailModal: BlessedBox;
  readonly detailClose: BlessedBox;

  readonly closeDialog: BlessedBox;
  readonly closeDialogText: BlessedBox;
  readonly closeDialogOptions: BlessedList;

  readonly updateDialog: BlessedBox;
  readonly updateDialogText: BlessedBox;
  readonly updateDialogOptions: BlessedList;

  constructor(options: DialogsComponentOptions) {
    this.screen = options.parent;
    this.blessedImpl = options.blessed || blessed;
    this.overlays = options.overlays;

    this.detailModal = this.blessedImpl.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '70%',
      label: ' Item Details ',
      border: { type: 'line' },
      hidden: true,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      clickable: true,
      style: { border: { fg: 'green' } },
      content: '',
    });

    this.detailClose = this.blessedImpl.box({
      parent: this.detailModal,
      top: 0,
      right: 1,
      height: 1,
      width: 3,
      content: '[x]',
      style: { fg: 'red' },
      mouse: true,
    });

    this.closeDialog = this.blessedImpl.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 10,
      label: ' Close Work Item ',
      border: { type: 'line' },
      hidden: true,
      tags: true,
      mouse: true,
      clickable: true,
      style: { border: { fg: 'magenta' } },
    });

    this.closeDialogText = this.blessedImpl.box({
      parent: this.closeDialog,
      top: 1,
      left: 2,
      height: 2,
      width: '100%-4',
      content: 'Close selected item with stage:',
      tags: false,
    });

    this.closeDialogOptions = this.blessedImpl.list({
      parent: this.closeDialog,
      top: 4,
      left: 2,
      width: '100%-4',
      height: 4,
      keys: true,
      mouse: true,
      style: {
        selected: { bg: 'blue' },
      },
      items: ['Close (in_review)', 'Close (done)', 'Close (deleted)', 'Cancel'],
    });

    this.updateDialog = this.blessedImpl.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 24,
      label: ' Update Work Item ',
      border: { type: 'line' },
      hidden: true,
      tags: true,
      mouse: true,
      clickable: true,
      style: { border: { fg: 'magenta' } },
    });

    this.updateDialogText = this.blessedImpl.box({
      parent: this.updateDialog,
      top: 1,
      left: 2,
      height: 2,
      width: '100%-4',
      content: 'Update selected item fields:',
      tags: false,
    });

    const updateDialogColumnWidth = '33%-2';
    const updateDialogListHeight = 15;
    const updateDialogListTop = 6;

    this.blessedImpl.box({
      parent: this.updateDialog,
      top: 4,
      left: 2,
      height: 1,
      width: updateDialogColumnWidth,
      content: 'Stage',
      tags: false,
    });

    this.blessedImpl.box({
      parent: this.updateDialog,
      top: 4,
      left: '33%+1',
      height: 1,
      width: updateDialogColumnWidth,
      content: 'Status',
      tags: false,
    });

    this.blessedImpl.box({
      parent: this.updateDialog,
      top: 4,
      left: '66%+1',
      height: 1,
      width: updateDialogColumnWidth,
      content: 'Priority',
      tags: false,
    });

    const stageList = this.blessedImpl.list({
      parent: this.updateDialog,
      top: updateDialogListTop,
      left: 2,
      width: updateDialogColumnWidth,
      height: updateDialogListHeight,
      keys: true,
      mouse: true,
      style: {
        selected: { bg: 'blue' },
      },
      items: ['idea', 'prd_complete', 'plan_complete', 'in_progress', 'in_review', 'done', 'blocked', 'Cancel'],
    });

    const statusList = this.blessedImpl.list({
      parent: this.updateDialog,
      top: updateDialogListTop,
      left: '33%+1',
      width: updateDialogColumnWidth,
      height: updateDialogListHeight,
      keys: true,
      mouse: true,
      style: {
        selected: { bg: 'blue' },
      },
      items: ['open', 'in-progress', 'blocked', 'completed', 'deleted', 'Cancel'],
    });

    const priorityList = this.blessedImpl.list({
      parent: this.updateDialog,
      top: updateDialogListTop,
      left: '66%+1',
      width: updateDialogColumnWidth,
      height: updateDialogListHeight,
      keys: true,
      mouse: true,
      style: {
        selected: { bg: 'blue' },
      },
      items: ['critical', 'high', 'medium', 'low', 'Cancel'],
    });

    this.updateDialogOptions = stageList;

    const updateLayout = () => {
      const screenHeight = Math.max(0, this.screen.height as number);
      const screenWidth = Math.max(0, this.screen.width as number);
      if (!screenHeight || !screenWidth) return;

      if (screenHeight < 28) {
        const height = Math.max(16, screenHeight - 4);
        this.updateDialog.height = height;
        stageList.height = Math.max(6, height - 9);
        statusList.height = stageList.height;
        priorityList.height = stageList.height;
      } else {
        this.updateDialog.height = 24;
        stageList.height = updateDialogListHeight;
        statusList.height = updateDialogListHeight;
        priorityList.height = updateDialogListHeight;
      }

      this.updateDialog.width = screenWidth < 100 ? '90%' : '70%';
    };

    this.updateDialog.on('show', updateLayout);
    this.screen.on('resize', updateLayout);
  }

  create(): this {
    return this;
  }

  getDetailOverlay(): any {
    return this.overlays.detailOverlay;
  }

  getCloseOverlay(): any {
    return this.overlays.closeOverlay;
  }

  getUpdateOverlay(): any {
    return this.overlays.updateOverlay;
  }

  show(): void {
    // Dialogs are shown individually.
  }

  hide(): void {
    this.detailModal.hide();
    this.closeDialog.hide();
    this.updateDialog.hide();
    this.overlays.hide();
  }

  focus(): void {
    // No single focus target.
  }

  destroy(): void {
    this.detailClose.destroy();
    this.detailModal.destroy();

    this.closeDialogOptions.destroy();
    this.closeDialogText.destroy();
    this.closeDialog.destroy();

    this.updateDialogOptions.destroy();
    this.updateDialogText.destroy();
    this.updateDialog.destroy();
  }
}
