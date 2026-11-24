namespace SparkWinHelper;

public interface IConsentVerifier
{
    int CheckAvailability();

    int RequestVerification(string message, nint window);
}

public static class Outcomes
{
    public const string Verified = "verified";
    public const string Cancelled = "cancelled";
    public const string Unavailable = "unavailable";
    public const string Error = "error";

    private const int Available = 0;
    private const int ResultVerified = 0;
    private const int ResultDeviceNotPresent = 1;
    private const int ResultNotConfiguredForUser = 2;
    private const int ResultDisabledByPolicy = 3;
    private const int ResultCanceled = 6;

    public static bool IsAvailable(int availability) => availability == Available;

    public static string OfVerification(int result) =>
        result switch
        {
            ResultVerified => Verified,
            ResultCanceled => Cancelled,
            ResultDeviceNotPresent or ResultNotConfiguredForUser or ResultDisabledByPolicy => Unavailable,
            _ => Error,
        };
}
