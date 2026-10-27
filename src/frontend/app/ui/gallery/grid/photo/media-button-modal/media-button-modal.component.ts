import {Component, HostListener, OnDestroy, OnInit} from '@angular/core';
import {MediaButtonModalData, MediaButtonModalService} from './media-button-modal.service';
import {Subscription} from 'rxjs';
import {NgFor, NgIf} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {IClientMediaFields, IMediaRequestBodyData} from '../../../../../../../common/entities/extension/IClientUIConfig';
import {NetworkService} from '../../../../../model/network/network.service';
import {Utils} from '../../../../../../../common/Utils';
import {IClientMediaButtonConfigWithBaseApiPath} from '../photo.grid.gallery.component';

@Component({
  selector: 'app-media-button-modal',
  templateUrl: './media-button-modal.component.html',
  styleUrls: ['./media-button-modal.component.css'],
  imports: [NgIf, NgFor, FormsModule],
  standalone: true
})
export class MediaButtonModalComponent implements OnInit, OnDestroy {
  modalData: MediaButtonModalData | null = null;
  formData: IMediaRequestBodyData = {};
  /**
   * Values proposed while typing, by custom field id (see suggestionsApiPath).
   */
  suggestions: Record<string, string[]> = {};
  private subscription: Subscription;

  constructor(private modalService: MediaButtonModalService,
              private networkService: NetworkService) {
  }

  ngOnInit(): void {
    this.subscription = this.modalService.modalData.subscribe(data => {
      this.modalData = data;
      if (data) {
        this.initFormData();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  getFieldLabel(field: IClientMediaFields): string {
    const labels: { [key in IClientMediaFields]: string } = {
      title: $localize`Title`,
      caption: $localize`Caption`,
      cameraData: $localize`Camera Data`,
      positionData: $localize`Position Data`,
      faces: $localize`Faces`,
      size: $localize`Size`,
      creationDate: $localize`Creation Date`,
      creationDateOffset: $localize`Creation Date Offset`,
      bitRate: $localize`Bit Rate`,
      duration: $localize`Duration`,
      fileSize: $localize`File Size`,
      fps: $localize`FPS`,
      keywords: $localize`Keywords`
    };
    return labels[field] || field;
  }

  getFieldValue(field: IClientMediaFields): any {
    if (!this.modalData) {
      return '';
    }

    const media = this.modalData.media;
    if (!media) {
      return ''; // selection mode: no single media to read from
    }
    const metadata = media.media.metadata;

    switch (field) {
      case 'title':
      case 'caption':
      case 'bitRate':
      case 'creationDate':
      case 'creationDateOffset':
      case 'duration':
      case 'fileSize':
      case 'fps':
        return (metadata as any)[field] || '';
      case 'cameraData':
      case 'positionData':
      case 'size':
        return JSON.stringify((metadata as any)[field] || {});
      case 'faces':
      case 'keywords':
        return JSON.stringify((metadata as any)[field] || []);
      default:
        return '';
    }
  }

  closeModal(): void {
    this.modalService.hideModal();
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.modalData?.visible) {
      this.closeModal();
    }
  }

  executeAction(): void {
    if (this.modalData && this.isFormValid()) {
      // save value to reuse in the next modal
      if (this.modalData?.button?.popup?.customFields) {
        this.modalData.button.popup.customFields.forEach(field => {
          if (field.keepValue) {
            this.modalService.setValue(field.id, this.formData.customFields[field.id]);
          }
        });
      }
      if (this.modalData.onSubmit) {
        const onSubmit = this.modalData.onSubmit;
        this.modalService.hideModal();
        onSubmit(this.formData).catch(console.error);
        return;
      }
      this.modalService.executeButtonAction(
        this.modalData.button,
        this.modalData.media,
        this.formData
      ).catch(console.error);
    }
  }

  isFormValid(): boolean {
    if (!this.modalData?.button?.popup?.customFields) {
      return true;
    }

    // Check if all required custom fields are properly filled
    for (const field of this.modalData.button.popup.customFields) {
      if (field.required) {
        const value = this.formData.customFields[field.id];

        // For boolean fields, required means it must be checked (true)
        if (field.type === 'boolean' && !value) {
          return false;
        }

        // For string fields, required means not empty
        if (field.type === 'string' && (!value || value.trim() === '')) {
          return false;
        }

        // For number fields, required means not null/undefined (0 is valid)
        if (field.type === 'number' && (value === null || value === undefined || value === '')) {
          return false;
        }
      }
    }

    return true;
  }

  private initFormData(): void {
    this.formData = {};
    if (this.modalData?.media && this.modalData?.button?.popup?.fields) {
      this.formData.fields = {};
      this.modalData.button.popup.fields.forEach(field => {
        this.formData.fields[field] = this.getFieldValue(field);
      });
    }
    if (this.modalData?.button?.popup?.customFields) {
      this.formData.customFields = {};
      this.modalData.button.popup.customFields.forEach(field => {
        // load last value if we should keep it
        if (field.keepValue && this.modalService.getValue(field.id) !== undefined) {
          this.formData.customFields[field.id] = this.modalService.getValue(field.id);
          return;
        }
        this.formData.customFields[field.id] = field.defaultValue ?? this.getDefaultValueForType(field.type);
      });
      this.loadSuggestions();
    }
  }

  private loadSuggestions(): void {
    this.suggestions = {};
    const button = this.modalData.button as IClientMediaButtonConfigWithBaseApiPath;
    for (const field of button.popup.customFields) {
      if (field.type !== 'string' || !field.suggestionsApiPath) {
        continue;
      }
      this.networkService.getJson<string[]>(Utils.concatUrls(button.extensionBasePath, field.suggestionsApiPath))
        .then((values) => {
          if (this.modalData?.button === button && Array.isArray(values)) {
            this.suggestions[field.id] = values;
          }
        })
        .catch(console.error); // the field still takes any value
    }
  }

  private getDefaultValueForType(type: 'string' | 'number' | 'boolean'): any {
    switch (type) {
      case 'string':
        return '';
      case 'number':
        return 0;
      case 'boolean':
        return false;
      default:
        return '';
    }
  }
}
