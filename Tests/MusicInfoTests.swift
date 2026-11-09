import Foundation
@main struct Tests {
 static func main() {
  func row(_ title: String, _ artist: String, _ date: String, _ note: String = "") -> [String: Any] { ["id":"03cbd558-2cff-4b94-8238-e40528b91980", "title":title,"artist-credit":[["name":artist]],"first-release-date":date,"disambiguation":note] }
  let rows=[row("Hover","Nick DePirro","2024-02-16"),row("Hover","Wrong Artist","1994"),row("Hover (Live)","Nick DePirro","2020"),row("Hover","Nick DePirro","2024-02","different version"),row("Hover","Nick DePirro","2024-02-16"),row("Hover","Nick DePirro","not a date")]
  let matches=MusicInfo.matches(rows,title:"Hover",artist:"Nick DePirro",kind:"album")
  assert(matches.count==2)
  assert(matches[0]["date"]=="2024-02-16" && matches[1]["date"]=="2024-02")
  assert(matches[0]["url"]!.contains("/release-group/"))
  assert(MusicInfo.matches(rows,title:"Hover",artist:"Other",kind:"song").isEmpty)
  print("PASS: exact artist/title matching, partial release dates, version ambiguity, duplicate suppression, invalid-date rejection, and source links")
 }
}
