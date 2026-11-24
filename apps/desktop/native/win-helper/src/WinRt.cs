using System.Runtime.InteropServices;

namespace SparkWinHelper;

public sealed class WinRtException : Exception
{
    public WinRtException(int hresult)
        : base($"WinRT call failed (HRESULT 0x{hresult:X8}).")
    {
        HResult = hresult;
    }
}

internal static unsafe partial class WinRt
{
    private const int MultiThreaded = 1;
    private const int StatusStarted = 0;
    private const int StatusCompleted = 1;
    private const int PollMilliseconds = 50;
    private const int AsyncInfoStatusSlot = 7;
    private const int AsyncInfoErrorCodeSlot = 8;
    private const int AsyncOperationGetResultsSlot = 8;

    private static readonly Guid AsyncInfoIid = new("00000036-0000-0000-C000-000000000046");

    public static void Initialize() => RoInitialize(MultiThreaded);

    public static void Check(int hresult)
    {
        if (hresult < 0)
        {
            throw new WinRtException(hresult);
        }
    }

    public static ComObject Factory(string className, Guid iid)
    {
        using var name = new HString(className);
        nint factory;
        Check(RoGetActivationFactory(name.Handle, &iid, &factory));
        return new ComObject(factory);
    }

    public static int AwaitEnum(ComObject operation)
    {
        using var info = operation.As(AsyncInfoIid);
        var readStatus = (delegate* unmanaged[Stdcall]<nint, int*, int>)info.Slot(AsyncInfoStatusSlot);
        int status;
        while (true)
        {
            Check(readStatus(info.Pointer, &status));
            if (status != StatusStarted)
            {
                break;
            }
            Thread.Sleep(PollMilliseconds);
        }
        if (status != StatusCompleted)
        {
            int code;
            var readError = (delegate* unmanaged[Stdcall]<nint, int*, int>)info.Slot(AsyncInfoErrorCodeSlot);
            Check(readError(info.Pointer, &code));
            throw new WinRtException(code < 0 ? code : unchecked((int)0x80004004));
        }
        int result;
        var getResults = (delegate* unmanaged[Stdcall]<nint, int*, int>)operation.Slot(AsyncOperationGetResultsSlot);
        Check(getResults(operation.Pointer, &result));
        return result;
    }

    [LibraryImport("combase.dll")]
    private static partial int RoInitialize(int initType);

    [LibraryImport("combase.dll")]
    private static partial int RoGetActivationFactory(nint activatableClassId, Guid* iid, nint* factory);

    [LibraryImport("combase.dll")]
    internal static partial int WindowsCreateString(char* source, uint length, nint* result);

    [LibraryImport("combase.dll")]
    internal static partial int WindowsDeleteString(nint text);
}

internal sealed unsafe class HString : IDisposable
{
    public HString(string text)
    {
        nint handle;
        fixed (char* source = text)
        {
            WinRt.Check(WinRt.WindowsCreateString(source, (uint)text.Length, &handle));
        }
        Handle = handle;
    }

    public nint Handle { get; private set; }

    public void Dispose()
    {
        if (Handle != 0)
        {
            WinRt.WindowsDeleteString(Handle);
            Handle = 0;
        }
    }
}

internal sealed unsafe class ComObject(nint pointer) : IDisposable
{
    private const int QueryInterfaceSlot = 0;
    private const int ReleaseSlot = 2;

    public nint Pointer { get; private set; } = pointer;

    public void* Slot(int index) => (*(void***)Pointer)[index];

    public ComObject As(Guid iid)
    {
        WinRt.Check(TryAs(iid, out var result));
        return result!;
    }

    public int TryAs(Guid iid, out ComObject? result)
    {
        nint found;
        var query = (delegate* unmanaged[Stdcall]<nint, Guid*, nint*, int>)Slot(QueryInterfaceSlot);
        var hresult = query(Pointer, &iid, &found);
        result = hresult >= 0 ? new ComObject(found) : null;
        return hresult;
    }

    public void Dispose()
    {
        if (Pointer != 0)
        {
            ((delegate* unmanaged[Stdcall]<nint, uint>)Slot(ReleaseSlot))(Pointer);
            Pointer = 0;
        }
    }
}
