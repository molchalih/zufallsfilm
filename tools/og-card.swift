// Renders src/web/og.png, the card a messenger shows for a shared link.
//
//   swift tools/og-card.swift src/web/og.png
//
// The card is committed, so this runs only when the art changes. It draws with
// CoreGraphics against the fonts macOS ships, which is why it is Swift and not
// part of the Bun build: nothing in the runtime rasterises text, and a card
// that has to survive a messenger's cache is worth keeping reproducible.
//
// Messengers cache a card by URL for days. Changing the art means changing the
// path in index.html and in the route, not just these bytes.

import Foundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

let W = 1200.0, H = 630.0
let M = 72.0

func rgb(_ hex: UInt32) -> CGColor {
  CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255.0,
          green: CGFloat((hex >> 8) & 0xff) / 255.0,
          blue: CGFloat(hex & 0xff) / 255.0, alpha: 1)
}

let bg = rgb(0xf2f1ec), ink = rgb(0x141414), accent = rgb(0xe0201b), muted = rgb(0x8a887f)

let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: Int(W), height: Int(H), bitsPerComponent: 8,
                    bytesPerRow: 0, space: cs,
                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!

ctx.setFillColor(bg)
ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))

func line(_ s: String, _ face: String, _ size: Double, _ color: CGColor, kern: Double = 0) -> CTLine {
  let font = CTFontCreateWithName(face as CFString, size, nil)
  var attrs: [NSAttributedString.Key: Any] = [
    .init(kCTFontAttributeName as String): font,
    .init(kCTForegroundColorAttributeName as String): color,
  ]
  if kern != 0 { attrs[.init(kCTKernAttributeName as String)] = kern }
  return CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
}

// Draw with `x` as the left edge and `y` as the baseline, measured from the bottom.
func draw(_ l: CTLine, x: Double, y: Double) {
  ctx.textPosition = CGPoint(x: x, y: y)
  CTLineDraw(l, ctx)
}

func width(_ l: CTLine) -> Double { CTLineGetTypographicBounds(l, nil, nil, nil) }

// ── Header: the site's 11px mark and wordmark, scaled to the card ──────────
let markSize = 20.0
let headBaseline = H - M - 22.0
ctx.setFillColor(accent)
ctx.fill(CGRect(x: M, y: headBaseline - 1, width: markSize, height: markSize))
draw(line("zufallsfilm", "HelveticaNeue-Bold", 30, ink), x: M + markSize + 22, y: headBaseline)

// ── Headline, set against the bottom-left like the error page's foot ───────
let headlineSize = 78.0
let leading = headlineSize * 1.14
let l1 = line("A random film from your", "HelveticaNeue-Bold", headlineSize, ink, kern: -headlineSize * 0.03)
let l2 = line("Letterboxd watchlist.", "HelveticaNeue-Bold", headlineSize, ink, kern: -headlineSize * 0.03)
let lastBaseline = M + 74.0
draw(l1, x: M, y: lastBaseline + leading)
draw(l2, x: M, y: lastBaseline)

// ── The API, opposite the headline's last line ─────────────────────────────
let api = line("GET /pick?user=…", "Menlo-Regular", 24, muted)
draw(api, x: W - M - width(api), y: M)

let img = ctx.makeImage()!
let out = URL(fileURLWithPath: CommandLine.arguments[1])
let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, img, nil)
CGImageDestinationFinalize(dest)
print("wrote \(out.path)")
