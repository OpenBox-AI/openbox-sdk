// Regression fixture for block-comment line-number preservation.
// stripComments must replace multiline /* ... */ with a matching number of
// newlines so rule findings report the correct line number in origLines.

/*
 * A multi-line block comment occupying many lines
 * to push the real bug further down the file.
 * If stripComments collapses this block into nothing,
 * every line below would be mis-reported.
 * Line 1 of block
 * Line 2 of block
 * Line 3 of block
 * Line 4 of block
 */

// Line 15: a deliberately-bad pattern. With correct stripComments, the
// finding should report line 17 (the activity_input line). With the old
// buggy stripComments, it would report line ~9 or similar.

const bad = { activity_input: { prompt: 'x' } };   // line 17; should fire
