global using Microsoft.AspNetCore.Builder;
global using Microsoft.AspNetCore.Http;
foreach(var bad in new[]{"javascript:alert(1)","data:text/html,test","file:///etc/passwd","https://user:password@example.com/","relative/path","https://exam\nple.com/"}){
 try{Lessons.ValidateUrl(bad);throw new Exception("Accepted "+bad);}catch(ArgumentException){}
}
if(Lessons.ValidateUrl(" https://www.justinguitar.com/songs ")!="https://www.justinguitar.com/songs")throw new Exception("URL normalization");
if(Lessons.ValidateUrl("",true)!="")throw new Exception("Clearing a song link");
Console.WriteLine("PASS lesson URL schemes, credentials, absolute URLs, normalization and clearing");
