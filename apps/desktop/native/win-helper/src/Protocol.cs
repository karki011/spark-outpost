using System.Globalization;
using System.Text;
using System.Text.Json;

namespace SparkWinHelper;

public static class Protocol
{
    public const int Version = 1;
    public const int MaxMessageLength = 200;

    public static string Answer(string line, IConsentVerifier verifier)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(line);
        }
        catch (JsonException)
        {
            return Failure(null, "invalid", "The request is not JSON.");
        }
        using (document)
        {
            var root = document.RootElement;
            var id = root.ValueKind == JsonValueKind.Object ? Text(root, "id") : null;
            if (id is null)
            {
                return Failure(null, "invalid", "The request has no id.");
            }
            try
            {
                return Text(root, "op") switch
                {
                    "status" => Success(id, writer => writer.WriteNumber("protocol", Version)),
                    "hello.available" => Success(
                        id,
                        writer => writer.WriteBoolean("available", Outcomes.IsAvailable(verifier.CheckAvailability()))
                    ),
                    "hello.verify" => Verify(id, root, verifier),
                    _ => Failure(id, "unknown-op", "The helper does not know that op."),
                };
            }
            catch (WinRtException error)
            {
                return Failure(id, "failed", error.Message);
            }
            catch (Exception error) when (error is not OutOfMemoryException)
            {
                return Failure(id, "failed", $"The helper failed ({error.GetType().Name}).");
            }
        }
    }

    private static string Verify(string id, JsonElement root, IConsentVerifier verifier)
    {
        var message = Text(root, "message");
        if (message is null || message.Length == 0 || message.Length > MaxMessageLength)
        {
            return Failure(id, "invalid", "hello.verify needs a message of 1 to 200 characters.");
        }
        if (!TryWindow(root, out var window))
        {
            return Failure(id, "invalid", "hello.verify needs window as a decimal string or null.");
        }
        var outcome = Outcomes.OfVerification(verifier.RequestVerification(message, window));
        return Success(id, writer => writer.WriteString("outcome", outcome));
    }

    private static bool TryWindow(JsonElement root, out nint window)
    {
        window = 0;
        if (!root.TryGetProperty("window", out var value) || value.ValueKind == JsonValueKind.Null)
        {
            return true;
        }
        if (value.ValueKind != JsonValueKind.String)
        {
            return false;
        }
        if (!ulong.TryParse(value.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out var handle))
        {
            return false;
        }
        window = unchecked((nint)handle);
        return true;
    }

    private static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static string Success(string id, Action<Utf8JsonWriter> result) =>
        Write(writer =>
        {
            writer.WriteString("id", id);
            writer.WriteBoolean("ok", true);
            writer.WriteStartObject("result");
            result(writer);
            writer.WriteEndObject();
        });

    private static string Failure(string? id, string code, string message) =>
        Write(writer =>
        {
            if (id is null)
            {
                writer.WriteNull("id");
            }
            else
            {
                writer.WriteString("id", id);
            }
            writer.WriteBoolean("ok", false);
            writer.WriteString("code", code);
            writer.WriteString("message", message);
        });

    private static string Write(Action<Utf8JsonWriter> body)
    {
        using var stream = new MemoryStream();
        using (var inner = new Utf8JsonWriter(stream))
        {
            inner.WriteStartObject();
            body(inner);
            inner.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }
}
