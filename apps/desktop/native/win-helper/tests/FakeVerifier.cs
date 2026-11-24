namespace SparkWinHelper.Tests;

internal sealed class FakeVerifier : IConsentVerifier
{
    public int Availability { get; set; }

    public int Result { get; set; }

    public Exception? Failure { get; set; }

    public List<(string Message, nint Window)> Asked { get; } = [];

    public int CheckAvailability() => Failure is null ? Availability : throw Failure;

    public int RequestVerification(string message, nint window)
    {
        Asked.Add((message, window));
        return Failure is null ? Result : throw Failure;
    }
}
