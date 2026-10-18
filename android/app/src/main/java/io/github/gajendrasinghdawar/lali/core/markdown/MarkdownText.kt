package io.github.gajendrasinghdawar.lali.core.markdown

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import io.github.gajendrasinghdawar.lali.theme.Crimson11
import io.github.gajendrasinghdawar.lali.theme.Slate3
import io.github.gajendrasinghdawar.lali.theme.Slate6
import io.github.gajendrasinghdawar.lali.theme.Slate11
import org.commonmark.node.*
import org.commonmark.parser.Parser

private val parser = Parser.builder().build()

@Composable
fun MarkdownText(text: String) {
    val document = remember(text) { parser.parse(text) }
    if (text.isNotBlank()) SelectionContainer {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) { MarkdownBlocks(document) }
    }
}

@Composable
private fun MarkdownBlocks(parent: Node) {
    var node = parent.firstChild
    while (node != null) {
        val current = node
        when (current) {
            is Heading -> Text(inlineText(current), modifier = Modifier.padding(top = 8.dp).semantics { heading() }, style = when (current.level) {
                1 -> MaterialTheme.typography.titleLarge
                2 -> MaterialTheme.typography.titleMedium
                else -> MaterialTheme.typography.titleSmall
            })
            is Paragraph -> Text(inlineText(current), style = MaterialTheme.typography.bodyMedium)
            is BulletList, is OrderedList -> Column(Modifier.padding(start = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                var item = current.firstChild
                var index = 1
                while (item != null) {
                    val listItem = item
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (current is OrderedList) "${current.markerStartNumber + index - 1}." else "\u2022")
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) { MarkdownBlocks(listItem) }
                    }
                    item = item.next
                    index++
                }
            }
            is BlockQuote -> Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.width(2.dp).fillMaxHeight().background(Slate6))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) { MarkdownBlocks(current) }
            }
            is ThematicBreak -> HorizontalDivider(color = Slate6)
            is FencedCodeBlock -> CodeBlock(current.literal, current.info.orEmpty())
            is IndentedCodeBlock -> CodeBlock(current.literal)
            else -> if (current.firstChild != null) MarkdownBlocks(current)
        }
        node = current.next
    }
}

@Composable
private fun CodeBlock(text: String, language: String = "") {
    Column(Modifier.fillMaxWidth().background(Slate3, RoundedCornerShape(12.dp)).border(1.dp, Slate6, RoundedCornerShape(12.dp)), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (language.isNotBlank()) {
            Text(language, color = Slate11, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 16.dp, top = 12.dp, end = 16.dp))
            HorizontalDivider(color = Slate6)
        }
        Text(text.trimEnd('\n'), modifier = Modifier.horizontalScroll(rememberScrollState()).padding(16.dp), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, softWrap = false)
    }
}

private fun inlineText(parent: Node): AnnotatedString = buildAnnotatedString {
    fun appendChildren(parent: Node) {
        var node = parent.firstChild
        while (node != null) {
            when (val current = node) {
                is org.commonmark.node.Text -> append(current.literal)
                is Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, color = Crimson11)) { append(current.literal) }
                is StrongEmphasis -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { appendChildren(current) }
                is Emphasis -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendChildren(current) }
                is Link -> if (current.destination.startsWith("https://") || current.destination.startsWith("http://")) {
                    withLink(LinkAnnotation.Url(current.destination, TextLinkStyles(SpanStyle(color = Crimson11, textDecoration = TextDecoration.Underline)))) { appendChildren(current) }
                } else appendChildren(current)
                is SoftLineBreak -> append(" ")
                is HardLineBreak -> append("\n")
                else -> appendChildren(current)
            }
            node = node.next
        }
    }
    appendChildren(parent)
}
