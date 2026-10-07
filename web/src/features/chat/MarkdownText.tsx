import { MessageResponse } from '../../components/message'

export function MarkdownText({ content }: { content: string }) {
  return <MessageResponse mode='static'>{content}</MessageResponse>
}
