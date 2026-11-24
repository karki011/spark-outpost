using System.Text;

namespace SparkWinHelper;

public static class Program
{
    public static int Main()
    {
        WinRt.Initialize();
        var verifier = new WindowsHello();
        var encoding = new UTF8Encoding(false);
        using var input = new StreamReader(Console.OpenStandardInput(), encoding);
        using var output = new StreamWriter(Console.OpenStandardOutput(), encoding)
        {
            AutoFlush = true,
            NewLine = "\n",
        };
        string? line;
        while ((line = input.ReadLine()) is not null)
        {
            if (line.Trim().Length == 0)
            {
                continue;
            }
            output.WriteLine(Protocol.Answer(line, verifier));
        }
        return 0;
    }
}
