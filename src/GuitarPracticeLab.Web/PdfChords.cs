using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml.Linq;

// Poppler positions use the same PDF page geometry as the existing page renderer.
public static class PdfChords
{
    public sealed record Hit(string Name, double X, double Y, double Width, double Height);
    public sealed record Page(int Number, List<Hit> Chords);
    static readonly Regex Chord = new(@"^[A-G](?:#|b)?(?:(?:maj|min|m|M|dim|aug|sus|add)?(?:2|4|5|6|7|9|11|13)?(?:maj7|add9|sus2|sus4|b5|#5|b9|#9)?|ø7|°7?)(?:/[A-G](?:#|b)?)?$", RegexOptions.CultureInvariant);
    public static List<Page> Parse(string xml)
    {
        // Reject DTDs and external entities; PDFs are user-supplied files.
        using var text = new StringReader(xml);
        using var reader = System.Xml.XmlReader.Create(text, new System.Xml.XmlReaderSettings {
            DtdProcessing = System.Xml.DtdProcessing.Ignore, XmlResolver = null,
            MaxCharactersInDocument = 24 * 1024 * 1024
        });
        var document = XDocument.Load(reader);
        var pages = new List<Page>();
        foreach (var page in document.Descendants().Where(e => e.Name.LocalName == "page"))
        {
            double width = Number(page, "width"), height = Number(page, "height");
            var hits = new List<Hit>();
            if (width > 0 && height > 0)
            foreach (var word in page.Descendants().Where(e => e.Name.LocalName == "word"))
            {
                string name = word.Value.Trim().Trim('[', ']', '(', ')', ',', '|', ':').Replace('♯', '#').Replace('♭', 'b');
                if (!Chord.IsMatch(name)) continue;
                double x = Number(word, "xMin"), y = Number(word, "yMin"), right = Number(word, "xMax"), bottom = Number(word, "yMax");
                if (x < 0 || y < 0 || right > width + 1 || bottom > height + 1 || right <= x || bottom <= y) continue;
                hits.Add(new(name, x / width, y / height, Math.Min(right / width, 1) - x / width, Math.Min(bottom / height, 1) - y / height));
            }
            pages.Add(new(pages.Count + 1, hits));
        }
        return pages;
    }
    static double Number(XElement element, string attribute) =>
        double.TryParse(element.Attribute(attribute)?.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) ? n : 0;
}
