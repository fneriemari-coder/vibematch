import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/diagnostic_models.dart';

/// The diagnostic's hero moment: the four pillars drawn as a radar.
///
/// Hand-rolled with `CustomPaint` rather than pulled from a chart package —
/// the app ships no charting dependency, and the handful of primitives a
/// four-axis radar needs (rings, spokes, a filled polygon, four labels) are
/// cheaper to draw than to configure.
///
/// The polygon grows from the centre on first render, and the numbers count up
/// with it, so the reading arrives rather than simply being there.
class PillarRadarChart extends StatefulWidget {
  const PillarRadarChart({
    super.key,
    required this.pillars,
    this.highlightPillar,
    this.maxSide = 360,
  });

  final DiagnosticPillars pillars;

  /// Drawn with more weight than the other three — the pillar the finding is
  /// about. Ignored when it is not one of [diagnosticPillarKeys].
  final String? highlightPillar;

  /// The chart is square and takes the width it is given, up to this. Past
  /// ~360 the labels drift so far from the shape that it stops reading as one
  /// object.
  final double maxSide;

  @override
  State<PillarRadarChart> createState() => _PillarRadarChartState();
}

class _PillarRadarChartState extends State<PillarRadarChart>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );

  late final Animation<double> _growth = CurvedAnimation(
    parent: _controller,
    curve: Curves.easeOutCubic,
  );

  @override
  void initState() {
    super.initState();
    _controller.forward();
  }

  @override
  void didUpdateWidget(covariant PillarRadarChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Reopening the screen with a different diagnostic replays the reveal;
    // rebuilding with the same numbers must not.
    if (oldWidget.pillars.asList.toString() !=
        widget.pillars.asList.toString()) {
      _controller.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final values = widget.pillars.asList;
    final labels = diagnosticPillarKeys.map(diagnosticPillarLabel).toList();
    final highlightIndex = diagnosticPillarKeys
        .indexOf(widget.highlightPillar?.toUpperCase() ?? '');

    return Semantics(
      label: [
        for (var i = 0; i < labels.length; i++)
          '${labels[i]} ${values[i].round()} de 100',
      ].join(', '),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final available = constraints.maxWidth.isFinite
              ? constraints.maxWidth
              : widget.maxSide;
          final side = math.min(available, widget.maxSide);
          return Center(
            child: SizedBox(
              width: side,
              height: side,
              child: RepaintBoundary(
                child: AnimatedBuilder(
                  animation: _growth,
                  builder: (context, _) => CustomPaint(
                    size: Size.square(side),
                    painter: _RadarPainter(
                      values: values,
                      labels: labels,
                      progress: _growth.value,
                      highlightIndex: highlightIndex,
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _RadarPainter extends CustomPainter {
  _RadarPainter({
    required this.values,
    required this.labels,
    required this.progress,
    required this.highlightIndex,
  });

  /// 0..100, in [diagnosticPillarKeys] order — clockwise from the top.
  final List<double> values;
  final List<String> labels;

  /// 0 = collapsed to the centre, 1 = the real scores.
  final double progress;

  /// -1 when nothing is highlighted.
  final int highlightIndex;

  static const int _rings = 4;
  static const double _labelGap = 10;

  /// Top, right, bottom, left.
  double _angleAt(int index) => -math.pi / 2 + index * math.pi / 2;

  Offset _pointAt(Offset centre, double radius, int index) {
    final angle = _angleAt(index);
    return Offset(
      centre.dx + radius * math.cos(angle),
      centre.dy + radius * math.sin(angle),
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    final centre = Offset(size.width / 2, size.height / 2);

    // Lay the labels out first: the radius is whatever is left once the four
    // label blocks have their room, so the chart never clips its own axes.
    final blocks = <_LabelBlock>[
      for (var i = 0; i < labels.length; i++)
        _LabelBlock(
          name: _paintText(
            labels[i],
            VibeMatchTextStyles.caption.copyWith(
              fontSize: 12,
              fontWeight:
                  i == highlightIndex ? FontWeight.w800 : FontWeight.w600,
              color: i == highlightIndex
                  ? VibeMatchColors.textHigh
                  : VibeMatchColors.textLow,
              letterSpacing: 0.3,
            ),
          ),
          value: _paintText(
            '${(values[i] * progress).round()}',
            VibeMatchTextStyles.stat(20).copyWith(
              color: i == highlightIndex
                  ? VibeMatchColors.scoreGold
                  : VibeMatchColors.neonPrimary,
            ),
          ),
        ),
    ];

    final horizontalReserve =
        math.max(blocks[1].width, blocks[3].width) + _labelGap;
    final verticalReserve =
        math.max(blocks[0].height, blocks[2].height) + _labelGap;
    final radius = math.max(
      24.0,
      math.min(
        size.width / 2 - horizontalReserve,
        size.height / 2 - verticalReserve,
      ),
    );

    _paintGrid(canvas, centre, radius);
    _paintPolygon(canvas, centre, radius);
    _paintLabels(canvas, centre, radius, blocks);
  }

  /// Concentric rings plus the four spokes. Diamond rings rather than circles:
  /// on a four-axis radar they line the grid up with the shape being read.
  void _paintGrid(Canvas canvas, Offset centre, double radius) {
    final ringPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = VibeMatchColors.border;

    for (var ring = 1; ring <= _rings; ring++) {
      final ringRadius = radius * ring / _rings;
      final path = Path();
      for (var i = 0; i < labels.length; i++) {
        final point = _pointAt(centre, ringRadius, i);
        if (i == 0) {
          path.moveTo(point.dx, point.dy);
        } else {
          path.lineTo(point.dx, point.dy);
        }
      }
      path.close();
      canvas.drawPath(
        path,
        ringPaint
          ..color =
              ring == _rings ? VibeMatchColors.slate : VibeMatchColors.border,
      );
    }

    final spokePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = VibeMatchColors.border;
    for (var i = 0; i < labels.length; i++) {
      canvas.drawLine(centre, _pointAt(centre, radius, i), spokePaint);
    }
  }

  void _paintPolygon(Canvas canvas, Offset centre, double radius) {
    final path = Path();
    final vertices = <Offset>[];
    for (var i = 0; i < values.length; i++) {
      final reach = radius * (values[i] / 100) * progress;
      final point = _pointAt(centre, reach, i);
      vertices.add(point);
      if (i == 0) {
        path.moveTo(point.dx, point.dy);
      } else {
        path.lineTo(point.dx, point.dy);
      }
    }
    path.close();

    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.fill
        ..color = VibeMatchColors.neonPrimary.withOpacity(0.22),
    );
    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round
        ..color = VibeMatchColors.neonPrimary,
    );

    for (var i = 0; i < vertices.length; i++) {
      final isHighlight = i == highlightIndex;
      canvas.drawCircle(
        vertices[i],
        isHighlight ? 5.5 : 4,
        Paint()..color = VibeMatchColors.ink,
      );
      canvas.drawCircle(
        vertices[i],
        isHighlight ? 4 : 3,
        Paint()..color = VibeMatchColors.scoreGold,
      );
    }
  }

  /// Pillar name over its score, parked just outside each vertex.
  void _paintLabels(
    Canvas canvas,
    Offset centre,
    double radius,
    List<_LabelBlock> blocks,
  ) {
    for (var i = 0; i < blocks.length; i++) {
      final block = blocks[i];
      final anchor = _pointAt(centre, radius, i);
      late final Offset topLeft;
      switch (i) {
        case 0: // top — centred above the vertex
          topLeft = Offset(
            anchor.dx - block.width / 2,
            anchor.dy - _labelGap - block.height,
          );
        case 1: // right
          topLeft = Offset(
            anchor.dx + _labelGap,
            anchor.dy - block.height / 2,
          );
        case 2: // bottom
          topLeft = Offset(anchor.dx - block.width / 2, anchor.dy + _labelGap);
        default: // left
          topLeft = Offset(
            anchor.dx - _labelGap - block.width,
            anchor.dy - block.height / 2,
          );
      }
      block.paint(canvas, topLeft);
    }
  }

  static TextPainter _paintText(String text, TextStyle style) {
    return TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.center,
    )..layout();
  }

  @override
  bool shouldRepaint(_RadarPainter oldDelegate) =>
      oldDelegate.progress != progress ||
      oldDelegate.highlightIndex != highlightIndex ||
      !_sameValues(oldDelegate.values, values);

  static bool _sameValues(List<double> a, List<double> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

/// A laid-out "Vendas / 72" pair, measured once so the painter can reserve the
/// room it needs before choosing the radius.
class _LabelBlock {
  _LabelBlock({required this.name, required this.value});

  final TextPainter name;
  final TextPainter value;

  static const double _stackGap = 2;

  double get width => math.max(name.width, value.width);
  double get height => name.height + _stackGap + value.height;

  void paint(Canvas canvas, Offset topLeft) {
    name.paint(
        canvas, Offset(topLeft.dx + (width - name.width) / 2, topLeft.dy));
    value.paint(
      canvas,
      Offset(
        topLeft.dx + (width - value.width) / 2,
        topLeft.dy + name.height + _stackGap,
      ),
    );
  }
}
