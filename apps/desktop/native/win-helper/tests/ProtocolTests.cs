using System.Text.Json;
using Xunit;

namespace SparkWinHelper.Tests;

public class ProtocolTests
{
    private static JsonElement Ask(string line, FakeVerifier verifier) =>
        JsonDocument.Parse(Protocol.Answer(line, verifier)).RootElement.Clone();

    [Fact]
    public void StatusNamesTheProtocolVersion()
    {
        var answer = Ask("""{"id":"a","op":"status"}""", new FakeVerifier());
        Assert.Equal("a", answer.GetProperty("id").GetString());
        Assert.True(answer.GetProperty("ok").GetBoolean());
        Assert.Equal(1, answer.GetProperty("result").GetProperty("protocol").GetInt32());
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(1, false)]
    [InlineData(2, false)]
    [InlineData(3, false)]
    [InlineData(4, false)]
    [InlineData(99, false)]
    public void HelloIsAvailableOnlyWhenWindowsSaysAvailable(int availability, bool available)
    {
        var answer = Ask("""{"id":"b","op":"hello.available"}""", new FakeVerifier { Availability = availability });
        Assert.Equal(available, answer.GetProperty("result").GetProperty("available").GetBoolean());
    }

    [Theory]
    [InlineData(0, "verified")]
    [InlineData(1, "unavailable")]
    [InlineData(2, "unavailable")]
    [InlineData(3, "unavailable")]
    [InlineData(4, "error")]
    [InlineData(5, "error")]
    [InlineData(6, "cancelled")]
    [InlineData(42, "error")]
    public void VerifyReturnsOnlyTheOutcome(int result, string outcome)
    {
        var verifier = new FakeVerifier { Result = result };
        var answer = Ask("""{"id":"c","op":"hello.verify","message":"Unlock Spark Outpost"}""", verifier);
        var body = answer.GetProperty("result");
        Assert.Equal(outcome, body.GetProperty("outcome").GetString());
        Assert.Single(body.EnumerateObject());
    }

    [Fact]
    public void VerifyPassesTheMessageAndAWindowHandleBeyondDoublePrecision()
    {
        var verifier = new FakeVerifier();
        Ask("""{"id":"d","op":"hello.verify","message":"Unlock","window":"9007199254740993"}""", verifier);
        Assert.Equal(("Unlock", unchecked((nint)9007199254740993L)), verifier.Asked.Single());
    }

    [Theory]
    [InlineData("""{"id":"e","op":"hello.verify","message":"Unlock","window":null}""")]
    [InlineData("""{"id":"e","op":"hello.verify","message":"Unlock"}""")]
    public void VerifyWithoutAWindowAsksWithNone(string line)
    {
        var verifier = new FakeVerifier();
        Ask(line, verifier);
        Assert.Equal((nint)0, verifier.Asked.Single().Window);
    }

    [Theory]
    [InlineData("""{"id":"f","op":"hello.verify"}""")]
    [InlineData("""{"id":"f","op":"hello.verify","message":""}""")]
    [InlineData("""{"id":"f","op":"hello.verify","message":"Unlock","window":12}""")]
    [InlineData("""{"id":"f","op":"hello.verify","message":"Unlock","window":"-1"}""")]
    [InlineData("""{"id":"f","op":"hello.verify","message":"Unlock","window":"0x10"}""")]
    public void VerifyRefusesABadRequestWithoutAsking(string line)
    {
        var verifier = new FakeVerifier();
        var answer = Ask(line, verifier);
        Assert.False(answer.GetProperty("ok").GetBoolean());
        Assert.Equal("invalid", answer.GetProperty("code").GetString());
        Assert.Empty(verifier.Asked);
    }

    [Fact]
    public void VerifyRefusesAMessageOverTheLimit()
    {
        var verifier = new FakeVerifier();
        var message = new string('x', Protocol.MaxMessageLength + 1);
        var answer = Ask($$"""{"id":"g","op":"hello.verify","message":"{{message}}"}""", verifier);
        Assert.Equal("invalid", answer.GetProperty("code").GetString());
        Assert.Empty(verifier.Asked);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[1,2]")]
    [InlineData("""{"op":"status"}""")]
    [InlineData("""{"id":7,"op":"status"}""")]
    public void ALineWithoutAnIdIsInvalidWithANullId(string line)
    {
        var answer = Ask(line, new FakeVerifier());
        Assert.Equal(JsonValueKind.Null, answer.GetProperty("id").ValueKind);
        Assert.Equal("invalid", answer.GetProperty("code").GetString());
    }

    [Fact]
    public void AnUnknownOpIsRefused()
    {
        var answer = Ask("""{"id":"h","op":"uia.tree"}""", new FakeVerifier());
        Assert.Equal("h", answer.GetProperty("id").GetString());
        Assert.Equal("unknown-op", answer.GetProperty("code").GetString());
    }

    [Fact]
    public void AWinRtFailureIsReportedAndTheNextRequestStillWorks()
    {
        var verifier = new FakeVerifier { Failure = new WinRtException(unchecked((int)0x80070005)) };
        var failed = Ask("""{"id":"i","op":"hello.available"}""", verifier);
        Assert.Equal("failed", failed.GetProperty("code").GetString());
        Assert.Contains("0x80070005", failed.GetProperty("message").GetString());
        verifier.Failure = new InvalidOperationException("secret detail");
        var other = Ask("""{"id":"j","op":"hello.verify","message":"Unlock"}""", verifier);
        Assert.Equal("failed", other.GetProperty("code").GetString());
        Assert.DoesNotContain("secret detail", other.GetProperty("message").GetString());
        verifier.Failure = null;
        Assert.True(Ask("""{"id":"k","op":"status"}""", verifier).GetProperty("ok").GetBoolean());
    }
}
