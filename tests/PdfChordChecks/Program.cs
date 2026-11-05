static void Check(bool condition, string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS " + name); }
string xml = """
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://invalid.example/test.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><body><page width="600" height="800"><word xMin="60" yMin="80" xMax="90" yMax="96">[F♯m7]</word><word xMin="200" yMin="80" xMax="230" yMax="96">C/G</word><word xMin="300" yMin="80" xMax="340" yMax="96">Hello</word><word xMin="-5" yMin="80" xMax="30" yMax="96">Am</word></page><page width="600" height="800"/></body></html>
""";
var result = PdfChords.Parse(xml);
Check(result.Count == 2, "all pages including image-only page retained");
Check(result[0].Chords.Count == 2, "lyrics and out-of-page boxes rejected");
Check(result[0].Chords[0].Name == "F#m7", "brackets and musical accidentals normalized");
Check(result[0].Chords[1].Name == "C/G", "slash chord recognized");
Check(Math.Abs(result[0].Chords[0].X - .1) < .000001 && Math.Abs(result[0].Chords[0].Height - .02) < .000001, "normalized positions match image geometry");
Check(result[1].Chords.Count == 0, "scanned PDF page has no fabricated chord targets");
Console.WriteLine("All PDF chord checks passed.");
