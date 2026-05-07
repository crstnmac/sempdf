import type { ParsedPdfDocument, ParsedPdfFormField } from "../parser.js";
import type { RadioGroupOptions } from "../types.js";
import { assertNever, isPdfDictEntries } from "./document-helpers.js";
import type {
  CheckBoxAnnotation,
  ChoiceFieldAnnotation,
  InternalPageModel,
  PageAnnotation,
  PushButtonAnnotation,
  RadioGroupAnnotation,
  SignatureFieldAnnotation,
  TextFieldAnnotation
} from "./page-types.js";
import { positionTextRuns } from "./text-layout.js";
import { normalizePathStyle, normalizeTextBaseOptions } from "./validation.js";

export function flattenFormsOnPages(pages: Iterable<InternalPageModel>): void {
  for (const page of pages) {
    const retainedAnnotations: PageAnnotation[] = [];
    for (const annotation of page.annotations) {
      if (!isFlattenableFormAnnotation(annotation)) {
        retainedAnnotations.push(annotation);
        continue;
      }

      appendFlattenedAnnotationOps(page, annotation);
    }

    page.annotations.splice(0, page.annotations.length, ...retainedAnnotations);
  }
}

function isFlattenableFormAnnotation(
  annotation: PageAnnotation
): annotation is
  | TextFieldAnnotation
  | CheckBoxAnnotation
  | ChoiceFieldAnnotation
  | RadioGroupAnnotation
  | PushButtonAnnotation
  | SignatureFieldAnnotation {
  return (
    annotation.type === "textField"
    || annotation.type === "checkBox"
    || annotation.type === "choiceField"
    || annotation.type === "radioGroup"
    || annotation.type === "pushButton"
    || annotation.type === "signatureField"
  );
}

export function appendFlattenedAnnotationOps(
  page: InternalPageModel,
  annotation:
    | TextFieldAnnotation
    | CheckBoxAnnotation
    | ChoiceFieldAnnotation
    | RadioGroupAnnotation
    | PushButtonAnnotation
    | SignatureFieldAnnotation
): void {
  const defaultStroke = normalizePathStyle({
    paint: "stroke",
    stroke: {
      color: { kind: "gray", value: 0 },
      width: annotation.options.borderWidth
    }
  });

  switch (annotation.type) {
    case "textField":
    case "choiceField":
    case "pushButton":
    case "signatureField": {
      const label =
        annotation.type === "textField" || annotation.type === "choiceField"
          ? annotation.options.value
          : annotation.type === "pushButton"
            ? annotation.options.label
            : "[Signature]";

      page.ops.push({
        type: "path",
        commands: [
          {
            type: "rect",
            x: annotation.options.x,
            y: annotation.options.y,
            width: annotation.options.width,
            height: annotation.options.height
          }
        ],
        style: defaultStroke
      });

      if (label !== undefined && label.length > 0) {
        const font =
          annotation.type === "signatureField" ? "Helvetica-Oblique" : annotation.options.font;
        const fontSize = annotation.type === "signatureField" ? 10 : annotation.options.fontSize;
        const color =
          annotation.type === "signatureField"
            ? ({ kind: "gray", value: 0 } as const)
            : annotation.options.color;
        const textY =
          annotation.options.y + Math.max(annotation.options.height - fontSize - 4, 2);
        for (const run of positionTextRuns(
          label,
          normalizeTextBaseOptions({
            x: annotation.options.x + 2,
            y: textY,
            font,
            fontSize,
            color
          }),
          new Map()
        )) {
          page.ops.push({
            type: "text",
            text: run.text,
            options: run.options,
            ...(run.glyphs ? { glyphs: run.glyphs } : {})
          });
        }
      }
      return;
    }
    case "checkBox": {
      page.ops.push({
        type: "path",
        commands: [
          {
            type: "rect",
            x: annotation.options.x,
            y: annotation.options.y,
            width: annotation.options.width,
            height: annotation.options.height
          }
        ],
        style: defaultStroke
      });

      if (annotation.options.checked) {
        page.ops.push({
          type: "path",
          commands: [
            { type: "moveTo", x: annotation.options.x + 2, y: annotation.options.y + 2 },
            {
              type: "lineTo",
              x: annotation.options.x + annotation.options.width - 2,
              y: annotation.options.y + annotation.options.height - 2
            },
            {
              type: "moveTo",
              x: annotation.options.x + 2,
              y: annotation.options.y + annotation.options.height - 2
            },
            {
              type: "lineTo",
              x: annotation.options.x + annotation.options.width - 2,
              y: annotation.options.y + 2
            }
          ],
          style: normalizePathStyle({
            paint: "stroke",
            stroke: {
              color: { kind: "gray", value: 0 },
              width: Math.max(annotation.options.borderWidth, 1)
            }
          })
        });
      }
      return;
    }
    case "radioGroup": {
      for (const item of annotation.options.items) {
        page.ops.push({
          type: "path",
          commands: [
            { type: "rect", x: item.x, y: item.y, width: item.width, height: item.height }
          ],
          style: defaultStroke
        });

        if (annotation.options.value === item.value) {
          page.ops.push({
            type: "path",
            commands: [
              {
                type: "rect",
                x: item.x + item.width * 0.25,
                y: item.y + item.height * 0.25,
                width: item.width * 0.5,
                height: item.height * 0.5
              }
            ],
            style: normalizePathStyle({
              paint: "fill",
              fill: { color: { kind: "gray", value: 0 } }
            })
          });
        }
      }
      return;
    }
    default:
      return assertNever(annotation);
  }
}

export function appendFlattenedParsedFieldOps(
  base: ParsedPdfDocument,
  page: InternalPageModel,
  field: ParsedPdfFormField
): void {
  const rect = normalizeParsedFieldRect(field.rect);
  if (field.fieldType === "Btn" && field.buttonKind === "radio") {
    const items = readExistingRadioGroupItems(base, field.objectId);
    if (items.length === 0) {
      return;
    }

    appendFlattenedAnnotationOps(page, {
      type: "radioGroup",
      name: field.name,
      options: {
        items,
        value: field.value,
        borderWidth: 1,
        readOnly: field.readOnly ?? false,
        required: field.required ?? false
      }
    });
    return;
  }

  if (!rect) {
    return;
  }

  if (field.fieldType === "Btn" && field.buttonKind === "checkBox") {
    appendFlattenedAnnotationOps(page, {
      type: "checkBox",
      name: field.name,
      options: {
        ...rect,
        borderWidth: 1,
        checked: field.checked ?? false,
        readOnly: field.readOnly ?? false,
        required: field.required ?? false
      }
    });
    return;
  }

  if (field.fieldType === "Btn" && field.buttonKind === "pushButton") {
    appendFlattenedAnnotationOps(page, {
      type: "pushButton",
      name: field.name,
      options: {
        ...rect,
        label: readExistingPushButtonLabel(base, field.objectId) ?? field.name,
        font: "Helvetica",
        fontSize: 12,
        color: { kind: "gray", value: 0 },
        borderWidth: 1,
        readOnly: field.readOnly ?? false
      }
    });
    return;
  }

  if (field.fieldType === "Sig") {
    appendFlattenedAnnotationOps(page, {
      type: "signatureField",
      name: field.name,
      options: {
        ...rect,
        borderWidth: 1,
        readOnly: field.readOnly ?? false,
        required: field.required ?? false
      }
    });
    return;
  }

  if (field.fieldType === "Ch") {
    appendFlattenedAnnotationOps(page, {
      type: "choiceField",
      name: field.name,
      options: {
        ...rect,
        options: [...(field.options ?? [])],
        value: field.value,
        font: "Helvetica",
        fontSize: 12,
        color: { kind: "gray", value: 0 },
        borderWidth: 1,
        readOnly: field.readOnly ?? false,
        required: field.required ?? false,
        mode: field.choiceMode ?? "list"
      }
    });
    return;
  }

  appendFlattenedAnnotationOps(page, {
    type: "textField",
    name: field.name,
    options: {
      ...rect,
      value: field.value,
      font: "Helvetica",
      fontSize: 12,
      color: { kind: "gray", value: 0 },
      borderWidth: 1,
      readOnly: field.readOnly ?? false,
      required: field.required ?? false,
      multiline: field.multiline ?? false
    }
  });
}

function normalizeParsedFieldRect(
  rect: readonly number[] | undefined
): { x: number; y: number; width: number; height: number } | undefined {
  if (!rect || rect.length < 4) {
    return undefined;
  }

  const [x1, y1, x2, y2] = rect;
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return undefined;
  }

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

function readExistingPushButtonLabel(
  base: ParsedPdfDocument,
  objectId: number
): string | undefined {
  const dictValue = base.getObject(objectId)?.value;
  if (!isPdfDictEntries(dictValue)) {
    return undefined;
  }

  const mk = dictValue.find(([key]) => key === "MK")?.[1];
  if (!isPdfDictEntries(mk)) {
    return undefined;
  }

  const ca = mk.find(([key]) => key === "CA")?.[1];
  return typeof ca === "object" && ca !== null && "kind" in ca && ca.kind === "string"
    ? ca.value
    : undefined;
}

function readExistingRadioGroupItems(
  base: ParsedPdfDocument,
  objectId: number
): RadioGroupOptions["items"] {
  const dictValue = base.getObject(objectId)?.value;
  if (!isPdfDictEntries(dictValue)) {
    return [];
  }

  const kids = dictValue.find(([key]) => key === "Kids")?.[1];
  if (!Array.isArray(kids)) {
    return [];
  }

  const items: RadioGroupOptions["items"] = [];
  for (const kid of kids) {
    if (typeof kid !== "object" || kid === null || !("kind" in kid) || kid.kind !== "ref") {
      continue;
    }

    const widget = base.getObject(kid.objectId)?.value;
    if (!isPdfDictEntries(widget)) {
      continue;
    }

    const rectValue = widget.find(([key]) => key === "Rect")?.[1];
    const rect = Array.isArray(rectValue)
      ? normalizeParsedFieldRect(rectValue.filter((value): value is number => typeof value === "number"))
      : undefined;
    const value = readExistingRadioWidgetValue(widget);
    if (!rect || !value) {
      continue;
    }

    items.push({
      value,
      ...rect
    });
  }

  return items;
}

function readExistingRadioWidgetValue(dictValue: Array<[string, unknown]>): string | undefined {
  const ap = dictValue.find(([key]) => key === "AP")?.[1];
  if (!isPdfDictEntries(ap)) {
    return undefined;
  }

  const normal = ap.find(([key]) => key === "N")?.[1];
  if (!isPdfDictEntries(normal)) {
    return undefined;
  }

  const option = normal.find(([key]) => key !== "Off");
  return option?.[0];
}
