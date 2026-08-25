import { forwardRef, type ElementType, type ReactNode } from 'react'
import { Editable, type EditableProps } from './Editable'

type PresetProps = Omit<EditableProps, 'kind'> & { children?: ReactNode }

/** A headline, paragraph or label whose copy can be rewritten in the editor. */
export const EditableText = forwardRef<HTMLElement, PresetProps>(function EditableText(props, ref) {
  return <Editable ref={ref} kind="text" as={(props.as ?? 'p') as ElementType} {...props} />
})

/** An image whose source, alt text and framing can be swapped in the editor. */
export const EditableImage = forwardRef<HTMLElement, PresetProps>(function EditableImage(props, ref) {
  return <Editable ref={ref} kind="image" as="img" {...props} />
})

/** A layout container: spacing, background and inserted children all live here. */
export const EditableBox = forwardRef<HTMLElement, PresetProps>(function EditableBox(props, ref) {
  return <Editable ref={ref} kind="box" container as={(props.as ?? 'div') as ElementType} {...props} />
})

/** A link whose label and destination can be changed. */
export const EditableLink = forwardRef<HTMLElement, PresetProps>(function EditableLink(props, ref) {
  return <Editable ref={ref} kind="link" as={(props.as ?? 'a') as ElementType} {...props} />
})
