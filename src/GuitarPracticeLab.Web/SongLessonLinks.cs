public static partial class SongLibrary
{
    // Song lesson links remain canonical in song.json; Lessons projects them instead of copying them.
    // No SongLibrary operation takes the Lessons gate, so the read lock order cannot cycle.
    public static async Task<List<Lessons.Lesson>> LinkedLessons()
    {
        await Gate.WaitAsync();
        try
        {
            var lessons=new List<Lessons.Lesson>();
            foreach(var metadata in Directory.EnumerateFiles(Root,"song.json",SearchOption.AllDirectories))
            {
                var song=System.Text.Json.JsonSerializer.Deserialize<Song>(await File.ReadAllTextAsync(metadata),Json);
                if(song is null || string.IsNullOrWhiteSpace(song.LessonUrl))continue;
                lessons.Add(new Lessons.Lesson { Id=song.Id,SongId=song.Id,Title=song.Title,Url=song.LessonUrl,Notes=song.Notes,Updated=song.Updated });
            }
            return lessons;
        }
        finally { Gate.Release(); }
    }

    public static async Task SetLessonMapping(Guid? sourceId,Guid? targetId,string url,string notes,DateTimeOffset? sourceUpdated,DateTimeOffset? targetUpdated)
    {
        await Gate.WaitAsync();
        try
        {
            var source=sourceId.HasValue?Read(sourceId.Value):null;
            var target=targetId.HasValue?(sourceId==targetId?source:Read(targetId.Value)):null;
            if(source is not null && sourceUpdated!=source.Updated || target is not null && targetUpdated!=target.Updated)
                throw new ArgumentException("A selected song changed. Close and reopen this lesson before saving.");
            if(target is not null){target.LessonUrl=url;if(sourceId==targetId)target.Notes=notes;await Save(target);}
            if(source is not null && sourceId!=targetId){source.LessonUrl="";source.Notes=notes;await Save(source);}
        }
        finally { Gate.Release(); }
    }
}
