import type { PageSize, PageTransparencyGroupOptions, PdfStructureAttributeValue, PdfStructureTag } from "../types.js";
import type { PdfOp } from "./ops.js";
import {
  resolvePageSize,
  type NormalizedAttachmentOptions,
  type NormalizedCheckBoxOptions,
  type NormalizedChoiceFieldOptions,
  type NormalizedFreeTextAnnotationOptions,
  type NormalizedHighlightAnnotationOptions,
  type NormalizedNoteAnnotationOptions,
  type NormalizedOutlineOptions,
  type NormalizedPageLabelOptions,
  type NormalizedPageLinkOptions,
  type NormalizedPushButtonOptions,
  type NormalizedRadioGroupOptions,
  type NormalizedSignatureFieldOptions,
  type NormalizedSquigglyAnnotationOptions,
  type NormalizedStrikeOutAnnotationOptions,
  type NormalizedTextFieldOptions,
  type NormalizedUnderlineAnnotationOptions,
  type NormalizedUriLinkOptions,
  type ResolvedPageSize
} from "./validation.js";

export interface UriLinkAnnotation {
  readonly type: "uri";
  readonly url: string;
  readonly options: NormalizedUriLinkOptions;
  readonly structureGroupId?: number | undefined;
}

export interface PageLinkAnnotation {
  readonly type: "page";
  readonly target: InternalPageModel;
  readonly options: NormalizedPageLinkOptions;
  readonly structureGroupId?: number | undefined;
}

export interface HighlightAnnotation {
  readonly type: "highlight";
  readonly options: NormalizedHighlightAnnotationOptions;
  readonly structureGroupId?: number | undefined;
}

export interface UnderlineAnnotation {
  readonly type: "underline";
  readonly options: NormalizedUnderlineAnnotationOptions;
  readonly structureGroupId?: number | undefined;
}

export interface StrikeOutAnnotation {
  readonly type: "strikeOut";
  readonly options: NormalizedStrikeOutAnnotationOptions;
  readonly structureGroupId?: number | undefined;
}

export interface SquigglyAnnotation {
  readonly type: "squiggly";
  readonly options: NormalizedSquigglyAnnotationOptions;
  readonly structureGroupId?: number | undefined;
}

export interface NoteAnnotation {
  readonly type: "note";
  readonly options: NormalizedNoteAnnotationOptions;
  readonly structureGroupId?: number | undefined;
}

export interface FreeTextAnnotation {
  readonly type: "freeText";
  readonly options: NormalizedFreeTextAnnotationOptions;
  readonly structureGroupId?: number | undefined;
}

export interface TextFieldAnnotation {
  readonly type: "textField";
  readonly name: string;
  readonly options: NormalizedTextFieldOptions;
  readonly structureGroupId?: number | undefined;
}

export interface CheckBoxAnnotation {
  readonly type: "checkBox";
  readonly name: string;
  readonly options: NormalizedCheckBoxOptions;
  readonly structureGroupId?: number | undefined;
}

export interface ChoiceFieldAnnotation {
  readonly type: "choiceField";
  readonly name: string;
  readonly options: NormalizedChoiceFieldOptions;
  readonly structureGroupId?: number | undefined;
}

export interface RadioGroupAnnotation {
  readonly type: "radioGroup";
  readonly name: string;
  readonly options: NormalizedRadioGroupOptions;
  readonly structureGroupId?: number | undefined;
}

export interface PushButtonAnnotation {
  readonly type: "pushButton";
  readonly name: string;
  readonly options: NormalizedPushButtonOptions;
  readonly structureGroupId?: number | undefined;
}

export interface SignatureFieldAnnotation {
  readonly type: "signatureField";
  readonly name: string;
  readonly options: NormalizedSignatureFieldOptions;
  readonly structureGroupId?: number | undefined;
}

export type PageAnnotation =
  | UriLinkAnnotation
  | PageLinkAnnotation
  | HighlightAnnotation
  | UnderlineAnnotation
  | StrikeOutAnnotation
  | SquigglyAnnotation
  | NoteAnnotation
  | FreeTextAnnotation
  | TextFieldAnnotation
  | CheckBoxAnnotation
  | ChoiceFieldAnnotation
  | RadioGroupAnnotation
  | PushButtonAnnotation
  | SignatureFieldAnnotation;

export interface InternalNamedDestinationModel {
  readonly name: string;
  readonly target: InternalPageModel;
}

export interface InternalPageLabelModel {
  readonly target: InternalPageModel;
  readonly options: NormalizedPageLabelOptions;
}

export interface InternalAttachmentModel {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly options: NormalizedAttachmentOptions;
}

export interface PageOutlineTarget {
  readonly type: "page";
  readonly target: InternalPageModel;
}

export interface NamedOutlineTarget {
  readonly type: "named";
  readonly name: string;
}

export type InternalOutlineTarget = PageOutlineTarget | NamedOutlineTarget;

export interface InternalOutlineModel {
  readonly title: string;
  readonly target: InternalOutlineTarget;
  readonly options: NormalizedOutlineOptions;
  readonly children: InternalOutlineModel[];
}

export interface InternalStructureNode {
  readonly id: number;
  readonly role: Exclude<PdfStructureTag, "Artifact">;
  readonly children: InternalStructureNode[];
  readonly annotationIndexes: number[];
  structureId?: string | undefined;
  altText?: string | undefined;
  actualText?: string | undefined;
  language?: string | undefined;
  attributes?: Record<string, PdfStructureAttributeValue> | undefined;
  mathML?: string | undefined;
  associatedFiles?:
    | Array<{ name: string; data: Uint8Array | ArrayBuffer; mimeType?: string }>
    | undefined;
  phoneme?: string | undefined;
  expansion?: string | undefined;
  summary?: string | undefined;
}

export interface InternalPageModel {
  readonly size: ResolvedPageSize;
  readonly ops: PdfOp[];
  readonly annotations: PageAnnotation[];
  readonly structureRoots: InternalStructureNode[];
  readonly structureNodes: Map<number, InternalStructureNode>;
  graphicsDepth: number;
  nextStructureGroupId: number;
  transparencyGroup?: PageTransparencyGroupOptions | undefined;
  tabOrder?: "R" | "C" | "S" | undefined;
  contentOverlay?: { mode: "replace" | "append" | "prepend"; content: string } | undefined;
  /** Hierarchical form field parent-child tracking. Maps parent field name to array of child field names. */
  parentFieldKids?: Map<string, string[]> | undefined;
}

export function createPageModel(size: PageSize, transparencyGroup?: PageTransparencyGroupOptions, tabOrder?: "R" | "C" | "S"): InternalPageModel {
  return {
    size: resolvePageSize(size),
    ops: [],
    annotations: [],
    structureRoots: [],
    structureNodes: new Map(),
    graphicsDepth: 0,
    nextStructureGroupId: 0,
    ...(transparencyGroup === undefined ? {} : { transparencyGroup }),
    ...(tabOrder === undefined ? {} : { tabOrder })
  };
}

export function allocateStructureGroupId(page: InternalPageModel): number {
  const structureGroupId = page.nextStructureGroupId;
  page.nextStructureGroupId += 1;
  return structureGroupId;
}
