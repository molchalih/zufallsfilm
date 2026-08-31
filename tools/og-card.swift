// Renders src/web/og-red.png, the card a messenger shows for a shared link.
//
//   swift tools/og-card.swift src/web/og-red.png
//
// The card is committed, so this runs only when the art changes. It draws with
// CoreGraphics against the fonts macOS ships, which is why it is Swift and not
// part of the Bun build: nothing in the runtime rasterises text, and a card
// that has to survive a messenger's cache is worth keeping reproducible.
//
// Messengers cache a card by URL for days. Changing the art means changing the
// path in index.html and in the route, not just these bytes.
//
// The card carries the wordmark and nothing else: og:description already says
// what the site does, so repeating it in the art only crowds the field.

import Foundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

let W = 1200.0, H = 630.0
let M = 96.0

func rgb(_ hex: UInt32) -> CGColor {
  CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255.0,
          green: CGFloat((hex >> 8) & 0xff) / 255.0,
          blue: CGFloat(hex & 0xff) / 255.0, alpha: 1)
}

let accent = rgb(0xe0201b), paper = rgb(0xf2f1ec)

let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: Int(W), height: Int(H), bitsPerComponent: 8,
                    bytesPerRow: 0, space: cs,
                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!

ctx.setFillColor(accent)
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

// ── The site's square mark, over the wordmark, both in paper on the red ────
let wordSize = 104.0
let baseline = M + 8.0
let markSize = 32.0

ctx.setFillColor(paper)
ctx.fill(CGRect(x: M, y: baseline + wordSize * 0.92, width: markSize, height: markSize))
draw(line("zufallsfilm", "HelveticaNeue-Bold", wordSize, paper, kern: -wordSize * 0.035),
     x: M - wordSize * 0.045, y: baseline)

let img = ctx.makeImage()!
let out = URL(fileURLWithPath: CommandLine.arguments[1])
let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, img, nil)
CGImageDestinationFinalize(dest)
print("wrote \(out.path)")
