using System.Security.Cryptography;
using System.Text;
using Xunit;

namespace SparkWinHelper.Tests;

public class IidTests
{
    private static readonly byte[] WinRtNamespace = Convert.FromHexString("11f47ad57b7342c0abae878b1e16adee");

    private static Guid FromSignature(string signature)
    {
        var hash = SHA1.HashData([.. WinRtNamespace, .. Encoding.UTF8.GetBytes(signature)]);
        hash[6] = (byte)((hash[6] & 0x0f) | 0x50);
        hash[8] = (byte)((hash[8] & 0x3f) | 0x80);
        return new Guid(hash.AsSpan(0, 16), bigEndian: true);
    }

    [Fact]
    public void TheSignatureRuleGivesTheKnownIidOfAnAsyncBoolean()
    {
        var signature = "pinterface({9fc2b0bb-e446-44e2-aa61-9cab8f636af2};b1)";
        Assert.Equal(new Guid("cdb5efb3-5788-509d-9be1-71ccb8a3362a"), FromSignature(signature));
    }

    [Fact]
    public void TheVerificationOperationIidMatchesItsSignature()
    {
        Assert.Equal(
            FromSignature(WindowsHello.VerificationOperationSignature),
            WindowsHello.VerificationOperationIid
        );
    }
}
